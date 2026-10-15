//! Actualizaciones desde GitHub Releases. Toda la logica (consulta, descarga reanudable, verificacion SHA-256, extraccion segura y
//! reemplazo con rollback) vive en el crate `peshex-updater` y se ejecuta como proceso aparte (`PESHeX-Updater.exe`, junto a
//! `PESHeX.exe`): la app no incluye ninguna pila de red/TLS y el actualizador puede reemplazar a la propia app cuando esta cerrada.
//!
//! Flujo: `update_check` ejecuta `PESHeX-Updater check`; `update_start` copia el actualizador a `%TEMP%` (para que pueda
//! reemplazarse a si mismo), lo lanza con `run` y reenvia sus eventos como el evento Tauri `updater://event`; `update_control`
//! envia pausa/reanudar/cancelar; `update_apply` cierra el driver Ruby, ordena instalar y sale para que se reemplacen los archivos.
//!
//! Solo funciona en la version instalada (Windows, build de release): en desarrollo no hay actualizador junto al ejecutable.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rxdriver::DriverErrorDto;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::Mutex;

use crate::state::AppState;

/// Evento con los mensajes del actualizador (`{ event: "state"|"progress"|"verified"|"error"|"done"|"exited", ... }`).
const EVENT: &str = "updater://event";
const UPDATER_EXE: &str = "PESHeX-Updater.exe";
const RESULT_FILE: &str = "update-result.json";
/// Registro de diagnostico compartido con el actualizador (`<datos de la app>/updates/updater.log`).
const LOG_FILE: &str = "updater.log";
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct UpdaterState {
    run: Mutex<Option<Running>>,
}

struct Running {
    stdin: ChildStdin,
    /// El actualizador ya tiene el paquete verificado y preparado (se puede ordenar `apply`).
    ready: Arc<AtomicBool>,
}

fn err(kind: &str, msg: impl Into<String>) -> DriverErrorDto {
    DriverErrorDto::new(kind, msg)
}

/// El actualizador que acompana a este ejecutable, si existe (solo en la version instalada de Windows).
fn updater_beside(exe_dir: &Path) -> Option<PathBuf> {
    if !cfg!(windows) || cfg!(debug_assertions) {
        return None;
    }
    let p = exe_dir.join(UPDATER_EXE);
    p.is_file().then_some(p)
}

fn exe_dir() -> Result<PathBuf, DriverErrorDto> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .ok_or_else(|| err("NoExePath", "no se pudo saber donde esta instalado PESHeX"))
}

fn updater_path() -> Result<PathBuf, DriverErrorDto> {
    updater_beside(&exe_dir()?).ok_or_else(|| err("UpdaterUnavailable", "esta copia de PESHeX no incluye el actualizador"))
}

fn work_dir(app: &AppHandle) -> Result<PathBuf, DriverErrorDto> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("updates"))
        .map_err(|e| err("AppDataDir", format!("no se pudo resolver el directorio de datos: {e}")))
}

/// Anota en el registro de diagnostico (`[app] ...`). Nunca falla.
fn log(app: &AppHandle, level: &str, msg: &str) {
    if let Ok(dir) = work_dir(app) {
        peshex_core::logfile::append(&dir.join(LOG_FILE), level, &format!("[app] {msg}"));
    }
}

fn configure(cmd: &mut Command) {
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: el actualizador es de consola, que no parpadee una ventana negra
    #[cfg(not(windows))]
    let _ = cmd;
}

/// Ultima linea del stdout que sea un objeto JSON.
fn last_json_line(stdout: &str) -> Option<Value> {
    stdout.lines().rev().filter(|l| l.trim_start().starts_with('{')).find_map(|l| serde_json::from_str::<Value>(l).ok())
}

/// Copia el actualizador a `%TEMP%\PESHeX-Updater-<pid>\` y borra copias de ejecuciones anteriores que ya no esten en uso.
fn copy_to_temp(src: &Path) -> Result<PathBuf, DriverErrorDto> {
    let tmp = std::env::temp_dir();
    let mine = format!("PESHeX-Updater-{}", std::process::id());
    if let Ok(rd) = std::fs::read_dir(&tmp) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with("PESHeX-Updater-") && name != mine {
                let _ = std::fs::remove_dir_all(e.path()); // si una sigue en uso, Windows no la deja borrar: no pasa nada
            }
        }
    }
    let dir = tmp.join(mine);
    std::fs::create_dir_all(&dir).map_err(|e| err("Io", format!("no se pudo preparar el actualizador: {e}")))?;
    let dst = dir.join(UPDATER_EXE);
    std::fs::copy(src, &dst).map_err(|e| err("Io", format!("no se pudo copiar el actualizador: {e}")))?;
    Ok(dst)
}

/// ¿Esta copia de PESHeX puede actualizarse sola? (Hay actualizador al lado del ejecutable.)
#[tauri::command]
pub fn update_available() -> bool {
    exe_dir().ok().and_then(|d| updater_beside(&d)).is_some()
}

/// Consulta el ultimo Release. Devuelve el JSON de `PESHeX-Updater check`:
/// `{status:"upToDate"|"available"|"error"|"unavailable", ...}` (nunca falla por falta de red).
#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Value, DriverErrorDto> {
    let Ok(exe) = updater_path() else { return Ok(json!({ "status": "unavailable" })) };
    let current = app.package_info().version.to_string();
    let mut cmd = Command::new(exe);
    cmd.args(["check", "--current", &current]).stdin(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true);
    if let Ok(dir) = work_dir(&app) {
        cmd.arg("--log").arg(dir.join(LOG_FILE)); // el actualizador anota el resultado de la consulta
    }
    configure(&mut cmd);
    let out = match tokio::time::timeout(CHECK_TIMEOUT, cmd.output()).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            log(&app, "ERROR", &format!("no se pudo ejecutar la consulta de actualizaciones: {e}"));
            return Ok(json!({ "status": "error", "code": "updater_failed", "message": e.to_string() }));
        }
        Err(_) => {
            log(&app, "ERROR", "la consulta de actualizaciones no respondio en 30 s");
            return Ok(json!({ "status": "error", "code": "network", "message": "tiempo de espera agotado" }));
        }
    };
    Ok(last_json_line(&String::from_utf8_lossy(&out.stdout)).unwrap_or_else(|| json!({ "status": "error", "code": "updater_failed", "message": "respuesta ilegible" })))
}

/// Empieza a descargar y preparar `release` (el objeto `available.release` de `update_check`).
#[tauri::command]
pub async fn update_start(app: AppHandle, state: State<'_, UpdaterState>, release: Value) -> Result<(), DriverErrorDto> {
    let mut slot = state.run.lock().await;
    if slot.is_some() {
        return Err(err("UpdateBusy", "ya hay una actualización en curso"));
    }
    let copy = copy_to_temp(&updater_path()?).inspect_err(|e| log(&app, "ERROR", &format!("no se pudo copiar el actualizador a %TEMP%: {}", e.message)))?;
    let app_dir = exe_dir()?;
    let work = work_dir(&app)?;
    log(&app, "INFO", &format!("actualizacion a la {}: actualizador copiado a {}", release["version"].as_str().unwrap_or("?"), copy.display()));

    let mut cmd = Command::new(&copy);
    // OJO: sin `kill_on_drop`: al instalar, la app se cierra y el actualizador debe seguir vivo.
    cmd.arg("run").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    configure(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| {
        log(&app, "ERROR", &format!("no se pudo iniciar el actualizador {}: {e}", copy.display()));
        err("SpawnFailed", format!("no se pudo iniciar el actualizador: {e}"))
    })?;
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        return Err(err("SpawnFailed", "el actualizador no abrió sus tuberías"));
    };
    let start = json!({ "cmd": "start", "release": release, "appDir": app_dir, "workDir": work });
    stdin.write_all(format!("{start}\n").as_bytes()).await.map_err(|e| err("Io", e.to_string()))?;
    stdin.flush().await.map_err(|e| err("Io", e.to_string()))?;

    let ready = Arc::new(AtomicBool::new(false));
    *slot = Some(Running { stdin, ready: ready.clone() });
    drop(slot);

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if v["event"] == "state" && v["state"] == "ready" {
                ready.store(true, Ordering::SeqCst);
            }
            let _ = app2.emit(EVENT, &v);
        }
        let code = child.wait().await.ok().and_then(|s| s.code());
        log(&app2, "INFO", &format!("el proceso del actualizador termino (codigo {})", code.map_or("?".to_string(), |c| c.to_string())));
        if let Some(st) = app2.try_state::<UpdaterState>() {
            *st.run.lock().await = None;
        }
        let _ = app2.emit(EVENT, json!({ "event": "exited", "code": code }));
    });
    Ok(())
}

/// `pause` | `resume` | `cancel` sobre la descarga en curso (si no hay ninguna, no hace nada).
#[tauri::command]
pub async fn update_control(state: State<'_, UpdaterState>, action: String) -> Result<(), DriverErrorDto> {
    if !matches!(action.as_str(), "pause" | "resume" | "cancel") {
        return Err(err("InvalidArgument", format!("orden desconocida: {action}")));
    }
    let mut slot = state.run.lock().await;
    if let Some(run) = slot.as_mut() {
        let line = format!("{}\n", json!({ "cmd": action }));
        run.stdin.write_all(line.as_bytes()).await.map_err(|e| err("Io", e.to_string()))?;
        run.stdin.flush().await.map_err(|e| err("Io", e.to_string()))?;
    }
    Ok(())
}

/// Instala la version ya descargada y verificada: cierra el driver Ruby, ordena al actualizador reemplazar los archivos y sale.
/// El actualizador espera a que `PESHeX.exe` se cierre, reemplaza, y vuelve a abrir la app.
#[tauri::command]
pub async fn update_apply(app: AppHandle, state: State<'_, UpdaterState>, app_state: State<'_, AppState>) -> Result<(), DriverErrorDto> {
    let mut slot = state.run.lock().await;
    let run = slot.as_mut().ok_or_else(|| err("NoUpdate", "no hay ninguna actualización preparada"))?;
    if !run.ready.load(Ordering::SeqCst) {
        return Err(err("UpdateNotReady", "la actualización todavía no está lista"));
    }
    // El Ruby portatil vive dentro de la carpeta que se va a reemplazar: debe estar cerrado.
    if let Some(mut session) = app_state.driver.lock().await.take() {
        session.shutdown().await;
    }
    run.stdin.write_all(b"{\"cmd\":\"apply\"}\n").await.map_err(|e| err("Io", e.to_string()))?;
    run.stdin.flush().await.map_err(|e| err("Io", e.to_string()))?;
    drop(slot);
    log(&app, "INFO", "driver Ruby cerrado, orden de instalar enviada: PESHeX se cierra para que el actualizador reemplace los archivos");
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await; // que el actualizador alcance a leer la orden
        app.exit(0);
    });
    Ok(())
}

/// Ruta del registro de diagnostico de las actualizaciones (la interfaz la ofrece al fallar una).
#[tauri::command]
pub fn update_log_path(app: AppHandle) -> Result<String, DriverErrorDto> {
    Ok(work_dir(&app)?.join(LOG_FILE).to_string_lossy().into_owned())
}

/// Resultado del ultimo reemplazo (`{ok, version, code?, message?}`), una sola vez: la app recien abierta lo muestra.
#[tauri::command]
pub fn update_last_result(app: AppHandle) -> Result<Option<Value>, DriverErrorDto> {
    let path = work_dir(&app)?.join(RESULT_FILE);
    let Ok(text) = std::fs::read_to_string(&path) else { return Ok(None) };
    let _ = std::fs::remove_file(&path);
    Ok(serde_json::from_str(&text).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toma_la_ultima_linea_json() {
        let v = last_json_line("ruido\n{\"status\":\"upToDate\"}\n\n").unwrap();
        assert_eq!(v["status"], "upToDate");
        assert!(last_json_line("sin json\n").is_none());
        assert!(last_json_line("{roto\n").is_none());
    }

    #[test]
    fn en_desarrollo_o_fuera_de_windows_no_hay_actualizador() {
        let dir = std::env::temp_dir().join(format!("peshex-upd-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(UPDATER_EXE), b"x").unwrap();
        // Las pruebas corren en depuracion: nunca se ofrece actualizar el binario de desarrollo.
        assert!(updater_beside(&dir).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_copia_temporal_conserva_el_nombre() {
        let dir = std::env::temp_dir().join(format!("peshex-upd-copy-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("origen.exe");
        std::fs::write(&src, b"contenido").unwrap();
        let dst = copy_to_temp(&src).unwrap();
        assert_eq!(dst.file_name().unwrap(), UPDATER_EXE);
        assert_eq!(std::fs::read(&dst).unwrap(), b"contenido");
        let _ = std::fs::remove_dir_all(dst.parent().unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
