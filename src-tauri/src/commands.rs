use std::path::PathBuf;

use rxdriver::{DriverCallError, DriverErrorDto, DriverSession};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::state::AppState;

/// Resuelve el Ruby portatil embebido dentro de los recursos empaquetados
/// (ver tauri.conf.json `bundle.resources` y `scripts/setup-ruby.ps1`).
///
/// En un entorno de desarrollo sin ese Ruby portatil de Windows se usa el
/// `ruby` del PATH del sistema - es exactamente el mismo protocolo JSON de
/// `rxdata_driver.rb` (puro stdlib, sin dependencias de plataforma), asi
/// que sirve para probar toda la capa Rust<->Ruby sin necesitar Windows. La
/// build de Windows real siempre encuentra el binario embebido primero.
fn resolve_ruby_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), DriverErrorDto> {
    let resource_dir = app.path().resource_dir().map_err(|e| {
        DriverErrorDto::new(
            "ResourceDir",
            format!("no se pudo resolver el directorio de recursos: {e}"),
        )
    })?;

    let driver_script = resource_dir
        .join("rxdata")
        .join("driver")
        .join("rxdata_driver.rb");
    if !driver_script.is_file() {
        return Err(DriverErrorDto::new(
            "DriverMissing",
            format!(
                "no se encontro el driver empaquetado en '{}' (revisa build.rs y tauri.conf.json)",
                driver_script.display()
            ),
        ));
    }

    let bundled_ruby = resource_dir.join("ruby").join("bin").join("ruby.exe");
    if bundled_ruby.is_file() {
        return Ok((bundled_ruby, driver_script));
    }

    match which_ruby() {
        Some(system_ruby) => Ok((system_ruby, driver_script)),
        None => Err(DriverErrorDto::new(
            "RubyMissing",
            "no se encontro un Ruby portatil embebido ni un 'ruby' en el PATH del sistema",
        )),
    }
}

fn which_ruby() -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let exe_name = if cfg!(windows) { "ruby.exe" } else { "ruby" };
    std::env::split_paths(&path_var)
        .map(|dir| dir.join(exe_name))
        .find(|candidate| candidate.is_file())
}

/// Si el error fue de E/S o desincronizacion del proceso Ruby (no un error
/// de dominio como "entero invalido"), la sesion queda inservible: se saca
/// del estado y se mata, para que el proximo comando no reintente contra
/// una pipe rota.
fn finish(
    guard: &mut tokio::sync::MutexGuard<'_, Option<DriverSession>>,
    err: DriverCallError,
) -> DriverErrorDto {
    if err.is_fatal() {
        if let Some(mut dead) = guard.take() {
            dead.kill_blocking();
        }
    }
    err.to_dto()
}

const NO_SESSION_KIND: &str = "NoSessionOpen";
const NO_SESSION: &str = "No hay ningun archivo abierto. Abre un archivo primero.";

/// Comandos con comando de ciclo de vida propio: `driver_call` los rechaza
/// para que el frontend no pueda abrir/cerrar/apagar la sesion por la puerta
/// de atras (el Mutex y el proceso hijo los gestiona este modulo).
const LIFECYCLE_COMMANDS: &[&str] = &["open", "close", "shutdown", "ping", "check"];

async fn spawn_session(app: &AppHandle) -> Result<DriverSession, DriverErrorDto> {
    let (ruby_bin, driver_script) = resolve_ruby_paths(app)?;
    DriverSession::spawn(&ruby_bin, &driver_script)
        .await
        .map_err(|e| {
            DriverErrorDto::new(
                "SpawnFailed",
                format!("no se pudo iniciar el proceso Ruby: {e}"),
            )
        })
}

#[tauri::command]
pub async fn check_file(app: AppHandle, path: String) -> Result<Value, DriverErrorDto> {
    let mut session = spawn_session(&app).await?;
    let result = session
        .call("check", json!({ "path": path }))
        .await
        .map_err(|e| e.to_dto());
    session.shutdown().await;
    result
}

#[tauri::command]
pub async fn open_save(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    scripts: Vec<String>,
    autodetect: bool,
    page_size: u32,
) -> Result<Value, DriverErrorDto> {
    let mut guard = state.driver.lock().await;
    if let Some(mut old) = guard.take() {
        old.shutdown().await;
    }

    let mut session = spawn_session(&app).await?;
    let params = json!({
        "path": path,
        "scripts": scripts,
        "autodetect": autodetect,
        "pageSize": page_size,
    });
    match session.call("open", params).await {
        Ok(data) => {
            *guard = Some(session);
            Ok(data)
        }
        Err(e) => {
            session.shutdown().await;
            Err(e.to_dto())
        }
    }
}

#[tauri::command]
pub async fn close_save(state: State<'_, AppState>) -> Result<(), DriverErrorDto> {
    let mut guard = state.driver.lock().await;
    if let Some(mut session) = guard.take() {
        session.shutdown().await;
    }
    Ok(())
}

/// Puerta unica hacia el driver Ruby: el frontend manda el nombre del comando
/// y sus parametros, y recibe la respuesta JSON completa. Evita escribir un
/// comando Tauri tipado por cada comando nuevo del driver.
#[tauri::command]
pub async fn driver_call(
    state: State<'_, AppState>,
    cmd: String,
    params: Option<Value>,
) -> Result<Value, DriverErrorDto> {
    if LIFECYCLE_COMMANDS.contains(&cmd.as_str()) {
        return Err(DriverErrorDto::new(
            "ForbiddenCommand",
            format!("el comando '{cmd}' tiene su propio comando de ciclo de vida"),
        ));
    }

    let mut guard = state.driver.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| DriverErrorDto::new(NO_SESSION_KIND, NO_SESSION))?;
    match session.call(&cmd, params.unwrap_or_else(|| json!({}))).await {
        Ok(v) => Ok(v),
        Err(e) => Err(finish(&mut guard, e)),
    }
}
