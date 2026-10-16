use std::path::PathBuf;

use peshex_core::watch::stamp;
use rxdriver::{DriverCallError, DriverErrorDto, DriverSession};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

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

/// Evento hacia la interfaz con `{ path }`: otro programa reescribio el save abierto.
const SAVE_CHANGED_EVENT: &str = "save://changed";

/// Unicas ordenes que escriben el archivo del save: mientras duran, la vigilancia no mira (ver `peshex_core::watch`).
const SAVE_WRITERS: &[&str] = &["save", "restore_backup"];

/// ¿La respuesta de una orden de `SAVE_WRITERS` dice que SI escribio el archivo?
fn wrote_save(cmd: &str, data: &Value) -> bool {
    match cmd {
        "save" => data.get("applied").and_then(Value::as_bool).unwrap_or(false),
        "restore_backup" => data.get("restored").is_some(),
        _ => false,
    }
}

pub(crate) async fn spawn_session(app: &AppHandle) -> Result<DriverSession, DriverErrorDto> {
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
    state.watcher.stop();
    // La huella se toma ANTES de que Ruby lea el archivo: si el juego guarda mientras se abre, el siguiente sondeo lo ve.
    let baseline = stamp(std::path::Path::new(&path));

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
            // Rust avisa a la interfaz de que otro programa (el juego) reescribio el save abierto.
            let handle = app.clone();
            state.watcher.start(PathBuf::from(&path), baseline, move |p| {
                let _ = handle.emit(SAVE_CHANGED_EVENT, json!({ "path": p }));
            });
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
    state.watcher.stop();
    if let Some(mut session) = guard.take() {
        session.shutdown().await;
    }
    Ok(())
}

/// Vuelve a leer el save abierto del disco (lo guardo otro programa, p. ej. el juego) sin cerrar el proceso Ruby: se
/// conservan la carpeta del juego vinculada y el modo, y se pierden los cambios sin guardar. Si el archivo esta a medio
/// escribir, el driver responde con error y la sesion queda como estaba (a diferencia de `open_save`, que cierra la anterior
/// antes de saber si el archivo se puede leer).
#[tauri::command]
pub async fn reload_save(state: State<'_, AppState>) -> Result<Value, DriverErrorDto> {
    let mut guard = state.driver.lock().await;
    let session = guard
        .as_mut()
        .ok_or_else(|| DriverErrorDto::new(NO_SESSION_KIND, NO_SESSION))?;
    // Igual que al abrir: la huella de antes de leer, para no tragarse un guardado que ocurra durante la lectura.
    let before = state.watcher.path().and_then(|p| stamp(&p));
    match session.call("reload", json!({})).await {
        Ok(v) => {
            state.watcher.set_baseline(before);
            Ok(v)
        }
        Err(e) => Err(finish(&mut guard, e)),
    }
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
    // Una escritura propia no es un cambio ajeno: la vigilancia no mira mientras dura (el lock del driver sigue tomado, asi
    // que nada mas puede tocar la sesion) y despues anota como referencia la huella que dejo el guardado.
    let own_write = SAVE_WRITERS.contains(&cmd.as_str());
    if own_write {
        state.watcher.pause();
    }
    let result = session.call(&cmd, params.unwrap_or_else(|| json!({}))).await;
    if own_write {
        state.watcher.resume(matches!(&result, Ok(v) if wrote_save(&cmd, v)));
    }
    match result {
        Ok(v) => Ok(v),
        Err(e) => Err(finish(&mut guard, e)),
    }
}
