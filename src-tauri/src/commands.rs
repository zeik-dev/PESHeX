use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::driver_process::{
    CheckResult, DriverCallError, DriverSession, GetFieldResult, ListChangesResult,
    ListFieldsResult, ListTemplatesResult, NilReportResult, OpenResult, SaveResult, SetFieldResult,
};
use crate::state::AppState;

/// Resuelve el Ruby portatil embebido dentro de los recursos empaquetados
/// (ver tauri.conf.json `bundle.resources` y `scripts/setup-ruby.ps1`).
///
/// En este entorno de desarrollo (Linux) ese Ruby portatil de Windows no
/// existe, asi que si no se encuentra en resources/ se usa el `ruby` del
/// PATH del sistema - es exactamente el mismo protocolo JSON de
/// `rxdata_driver.rb` (puro stdlib, sin dependencias de plataforma), asi
/// que sirve para probar toda la capa Rust<->Ruby aqui mismo. La build de
/// Windows real siempre encuentra el binario embebido primero.
fn resolve_ruby_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("no se pudo resolver el directorio de recursos: {e}"))?;

    let driver_script = resource_dir
        .join("rxdata")
        .join("driver")
        .join("rxdata_driver.rb");
    if !driver_script.is_file() {
        return Err(format!(
            "no se encontro el driver empaquetado en '{}' (revisa build.rs y tauri.conf.json)",
            driver_script.display()
        ));
    }

    let bundled_ruby = resource_dir.join("ruby").join("bin").join("ruby.exe");
    if bundled_ruby.is_file() {
        return Ok((bundled_ruby, driver_script));
    }

    match which_ruby() {
        Some(system_ruby) => Ok((system_ruby, driver_script)),
        None => Err(
            "no se encontro un Ruby portatil embebido ni un 'ruby' en el PATH del sistema"
                .to_string(),
        ),
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
) -> String {
    let message = err.message();
    if err.is_fatal() {
        if let Some(mut dead) = guard.take() {
            dead.kill_blocking();
        }
    }
    message
}

const NO_SESSION: &str = "No hay ningun archivo abierto. Abri un archivo primero.";

#[tauri::command]
pub async fn check_file(app: AppHandle, path: String) -> Result<CheckResult, String> {
    let (ruby_bin, driver_script) = resolve_ruby_paths(&app)?;
    let mut session = DriverSession::spawn(&ruby_bin, &driver_script)
        .await
        .map_err(|e| format!("no se pudo iniciar el proceso Ruby: {e}"))?;
    let result = session.check(&path).await.map_err(|e| e.message());
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
) -> Result<OpenResult, String> {
    let mut guard = state.driver.lock().await;
    if let Some(mut old) = guard.take() {
        old.shutdown().await;
    }

    let (ruby_bin, driver_script) = resolve_ruby_paths(&app)?;
    let mut session = DriverSession::spawn(&ruby_bin, &driver_script)
        .await
        .map_err(|e| format!("no se pudo iniciar el proceso Ruby: {e}"))?;

    match session.open(&path, &scripts, autodetect, page_size).await {
        Ok(data) => {
            *guard = Some(session);
            Ok(data)
        }
        Err(e) => {
            session.shutdown().await;
            Err(e.message())
        }
    }
}

#[tauri::command]
pub async fn close_save(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.driver.lock().await;
    if let Some(mut session) = guard.take() {
        session.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_fields(
    state: State<'_, AppState>,
    filter_path: String,
    filter_type: Option<String>,
    page: u32,
) -> Result<ListFieldsResult, String> {
    let mut guard = state.driver.lock().await;
    let session = guard.as_mut().ok_or(NO_SESSION)?;
    match session
        .list_fields(&filter_path, filter_type.as_deref(), page)
        .await
    {
        Ok(v) => Ok(v),
        Err(e) => Err(finish(&mut guard, e)),
    }
}

#[tauri::command]
pub async fn get_field(state: State<'_, AppState>, index: u64) -> Result<GetFieldResult, String> {
    let mut guard = state.driver.lock().await;
    let session = guard.as_mut().ok_or(NO_SESSION)?;
    match session.get_field(index).await {
        Ok(v) => Ok(v),
        Err(e) => Err(finish(&mut guard, e)),
    }
}

#[tauri::command]
pub async fn list_templates(
    state: State<'_, AppState>,
    class_name: String,
) -> Result<ListTemplatesResult, String> {
    let mut guard = state.driver.lock().await;
    let session = guard.as_mut().ok_or(NO_SESSION)?;
    match session.list_templates(&class_name).await {
        Ok(v) => Ok(v),
        Err(e) => Err(finish(&mut guard, e)),
    }
}

#[tauri::command]
pub async fn set_field(
    state: State<'_, AppState>,
    index: u64,
    input: String,
    confirmed: bool,
) -> Result<SetFieldResult, String> {
    let mut guard = state.driver.lock().await;
    let session = guard.as_mut().ok_or(NO_SESSION)?;
    match session.set_field(index, &input, confirmed).await {
        Ok(v) => Ok(v),
        Err(e) => Err(finish(&mut guard, e)),
    }
}

#[tauri::command]
pub async fn list_changes(state: State<'_, AppState>) -> Result<ListChangesResult, String> {
    let mut guard = state.driver.lock().await;
    let session = guard.as_mut().ok_or(NO_SESSION)?;
    match session.list_changes().await {
        Ok(v) => Ok(v),
        Err(e) => Err(finish(&mut guard, e)),
    }
}

#[tauri::command]
pub async fn nil_report(state: State<'_, AppState>) -> Result<NilReportResult, String> {
    let mut guard = state.driver.lock().await;
    let session = guard.as_mut().ok_or(NO_SESSION)?;
    match session.nil_report().await {
        Ok(v) => Ok(v),
        Err(e) => Err(finish(&mut guard, e)),
    }
}

#[tauri::command]
pub async fn save(
    state: State<'_, AppState>,
    backup: bool,
    confirmed: bool,
) -> Result<SaveResult, String> {
    let mut guard = state.driver.lock().await;
    let session = guard.as_mut().ok_or(NO_SESSION)?;
    match session.save(backup, confirmed).await {
        Ok(v) => Ok(v),
        Err(e) => Err(finish(&mut guard, e)),
    }
}
