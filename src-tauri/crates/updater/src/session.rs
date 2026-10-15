//! Una actualizacion de principio a fin, dirigida por JSON de una linea por stdin y reportada por stdout.
//!
//! Ordenes (stdin):  `{"cmd":"start","release":{..},"appDir":"..","workDir":".."}` · `pause` · `resume` · `cancel` · `apply`
//! Eventos (stdout): `state` (downloading|paused|verifying|extracting|ready|applying|cancelled) · `progress` · `verified` · `error` · `done`
//!
//! Flujo: descargar (reanudable) → comprobar SHA-256 contra `SHA256SUMS.txt` del mismo Release → extraer y validar en una carpeta de
//! preparacion → `ready` → (cuando la app lo ordena con `apply`) reemplazar los archivos y relanzar PESHeX.
//! Si la app se cierra durante la descarga (EOF en stdin) se conserva lo bajado para reanudar la proxima vez.

use crate::apply::{self, Limits, SwapOptions};
use crate::download::{self, Control, DlEvent, Gate};
use crate::github::{self, ReleaseInfo};
use crate::http::{HostPolicy, Http};
use crate::{sums, Result, UpdateError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;

/// Resultado del ultimo reemplazo, para que la app que arranca despues lo muestre (`<workDir>/update-result.json`).
pub const RESULT_FILE: &str = "update-result.json";
/// Registro de diagnostico (`<workDir>/updater.log`): lo que paso en cada actualizacion, para poder saber por que falla una.
pub const LOG_FILE: &str = "updater.log";

/// Escritor del registro de esta sesion: lineas `[updater] ...` en `<workDir>/updater.log` (nunca falla ni interrumpe nada).
#[derive(Clone)]
pub struct Log {
    path: Option<Arc<PathBuf>>,
    /// Ultimo 10 % de descarga ya anotado (el progreso se registra de 10 en 10, no cada 150 ms).
    last_decile: Arc<AtomicI64>,
}

impl Log {
    pub fn new(work_dir: &Path) -> Self {
        Self::at_file(work_dir.join(LOG_FILE))
    }
    pub fn at_file(file: PathBuf) -> Self {
        Log { path: Some(Arc::new(file)), last_decile: Arc::new(AtomicI64::new(-1)) }
    }
    /// Sin archivo: no anota nada.
    pub fn disabled() -> Self {
        Log { path: None, last_decile: Arc::new(AtomicI64::new(-1)) }
    }
    pub fn info(&self, msg: &str) {
        if let Some(p) = &self.path {
            peshex_core::logfile::append(p, "INFO", &format!("[updater] {msg}"));
        }
    }
    pub fn error(&self, msg: &str) {
        if let Some(p) = &self.path {
            peshex_core::logfile::append(p, "ERROR", &format!("[updater] {msg}"));
        }
    }
    /// Anota el evento que se envia a la app (el progreso solo cada 10 %).
    fn event(&self, ev: &Event) {
        match ev {
            Event::State { state } => self.info(&format!("estado: {state}")),
            Event::Progress { downloaded, total, bytes_per_sec } => {
                let decile = if *total > 0 { (*downloaded as u128 * 10 / *total as u128) as i64 } else { 0 };
                if self.last_decile.swap(decile, Ordering::Relaxed) != decile {
                    self.info(&format!("descarga: {} de {} bytes ({} %), {} B/s", downloaded, total, decile * 10, bytes_per_sec));
                }
            }
            Event::Verified { sha256 } => self.info(&format!("huella SHA-256 verificada: {sha256}")),
            Event::Error { code, message } => self.error(&format!("{code}: {message}")),
            Event::Done { version } => self.info(&format!("actualizacion a la {version} terminada")),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Command {
    Start { release: Box<ReleaseInfo>, app_dir: PathBuf, work_dir: PathBuf },
    Pause,
    Resume,
    Cancel,
    Apply,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "event", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Event {
    State { state: String },
    Progress { downloaded: u64, total: u64, bytes_per_sec: u64 },
    Verified { sha256: String },
    Error { code: String, message: String },
    Done { version: String },
}

fn state(s: &str) -> Event {
    Event::State { state: s.to_string() }
}

pub type Emit = Arc<dyn Fn(&Event) + Send + Sync>;

pub struct Env {
    pub http: Http,
    pub download: download::Options,
    pub swap: SwapOptions,
    pub limits: Limits,
    pub main_exe: String,
    /// Volver a abrir PESHeX al terminar (las pruebas lo desactivan).
    pub relaunch: bool,
    /// Cuanto esperar a que PESHeX.exe se cierre antes de reemplazarlo.
    pub apply_wait: Duration,
}

impl Env {
    pub fn production() -> Self {
        Env {
            http: Http::new(HostPolicy::github()),
            download: download::Options::default(),
            swap: SwapOptions::default(),
            limits: Limits::default(),
            main_exe: crate::MAIN_EXE.to_string(),
            relaunch: true,
            apply_wait: Duration::from_secs(60),
        }
    }
}

struct Start {
    release: ReleaseInfo,
    app_dir: PathBuf,
    work_dir: PathBuf,
    log: Log,
}

/// Ejecuta una sesion. Devuelve el codigo de salida del proceso (0 = bien, cancelado o interrumpido; 1 = error ya informado).
pub fn run(input: impl BufRead + Send + 'static, emit: Emit, env: Env) -> i32 {
    let control = Control::new();
    let (start_tx, start_rx) = mpsc::channel::<Start>();
    let (apply_tx, apply_rx) = mpsc::channel::<()>();
    let applying = Arc::new(AtomicBool::new(false));

    {
        let control = control.clone();
        let applying = applying.clone();
        std::thread::spawn(move || {
            for line in input.lines() {
                let Ok(line) = line else { break };
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Command>(line) {
                    Ok(Command::Start { release, app_dir, work_dir }) => {
                        let log = Log::new(&work_dir);
                        let _ = start_tx.send(Start { release: *release, app_dir, work_dir, log });
                    }
                    Ok(Command::Pause) => control.pause(),
                    Ok(Command::Resume) => control.resume(),
                    Ok(Command::Cancel) => control.cancel(),
                    Ok(Command::Apply) => {
                        applying.store(true, Ordering::SeqCst);
                        let _ = apply_tx.send(());
                    }
                    Err(_) => {}
                }
            }
            // La app cerro la tuberia: salvo que ya haya ordenado instalar (entonces se cierra a proposito), se interrumpe.
            if !applying.load(Ordering::SeqCst) {
                control.abort();
            }
        });
    }

    let Ok(start) = start_rx.recv() else { return 0 };
    // Todo lo que se informa a la app queda tambien en el registro.
    let emit: Emit = {
        let inner = emit.clone();
        let log = start.log.clone();
        Arc::new(move |ev: &Event| {
            log.event(ev);
            inner(ev);
        })
    };
    start.log.info(&format!(
        "inicio: PESHeX-Updater {} ({}), actualizando a la {} (paquete {}, {} bytes); carpeta de la app: {}; descargas: {}",
        crate::VERSION,
        std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_else(|_| "?".into()),
        start.release.version,
        start.release.asset.name,
        start.release.asset.size,
        start.app_dir.display(),
        start.work_dir.display(),
    ));
    match flow(&start, &env, &control, &apply_rx, &emit) {
        Ok(()) => 0,
        Err(UpdateError::Cancelled) => {
            start.log.info("cancelado por el usuario: se borra lo descargado");
            emit(&state("cancelled"));
            0
        }
        Err(UpdateError::Aborted) => {
            start.log.info("la app cerro la tuberia antes de terminar: se conserva lo descargado para continuar luego");
            0
        }
        Err(e) => {
            emit(&Event::Error { code: e.code().to_string(), message: e.to_string() });
            1
        }
    }
}

fn check_gate(control: &Control, start: &Start) -> Result<()> {
    match control.state() {
        Gate::Go => Ok(()),
        Gate::Cancel => {
            download::discard(&start.work_dir, &start.release.asset.name);
            let _ = fs::remove_dir_all(start.app_dir.join(apply::STAGE_DIR));
            Err(UpdateError::Cancelled)
        }
        Gate::Abort => Err(UpdateError::Aborted),
    }
}

fn flow(start: &Start, env: &Env, control: &Control, apply_rx: &mpsc::Receiver<()>, emit: &Emit) -> Result<()> {
    let rel = &start.release;
    let asset = &rel.asset.name;
    if asset != &github::asset_name(&rel.version) || asset.contains(['/', '\\']) {
        return Err(UpdateError::Invalid(format!("nombre de paquete inesperado: {asset}")));
    }
    apply::check_writable(&start.app_dir)?;
    apply::cleanup_leftovers(&start.app_dir);
    fs::create_dir_all(&start.work_dir)?;

    emit(&state("downloading"));
    let sums_text = env.http.get_text(&rel.sums_url, None, 1024 * 1024)?;
    let expected = sums::find(&sums_text, asset).ok_or_else(|| UpdateError::NoChecksum(asset.clone()))?;
    start.log.info(&format!("huella esperada segun SHA256SUMS.txt: {expected}"));

    let zip = download::download(&env.http, &rel.asset.url, rel.asset.size, &start.work_dir, asset, control, &env.download, &mut |ev| match ev {
        DlEvent::Progress(p) => emit(&Event::Progress { downloaded: p.downloaded, total: p.total, bytes_per_sec: p.bytes_per_sec }),
        DlEvent::Paused => emit(&state("paused")),
        DlEvent::Resumed => emit(&state("downloading")),
    })?;

    emit(&state("verifying"));
    let actual = sums::sha256_file(&zip)?;
    if actual != expected {
        download::discard(&start.work_dir, asset);
        return Err(UpdateError::HashMismatch { expected, actual });
    }
    emit(&Event::Verified { sha256: actual });
    check_gate(control, start)?;

    emit(&state("extracting"));
    let stage = start.app_dir.join(apply::STAGE_DIR).join("stage");
    let _ = fs::remove_dir_all(&stage);
    let new_files = match apply::extract(&zip, &stage, &env.limits).and_then(|_| apply::validate(&stage, &env.main_exe)) {
        Ok(files) => files,
        Err(e) => {
            let _ = fs::remove_dir_all(start.app_dir.join(apply::STAGE_DIR));
            if matches!(e, UpdateError::BadArchive(_)) {
                download::discard(&start.work_dir, asset); // un zip que no sirve no se vuelve a usar
            }
            return Err(e);
        }
    };
    check_gate(control, start)?;
    start.log.info(&format!("paquete preparado y validado: {} archivos en {}", new_files.len(), stage.display()));
    emit(&state("ready"));

    loop {
        match apply_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(()) => break,
            Err(RecvTimeoutError::Timeout) => check_gate(control, start)?,
            Err(RecvTimeoutError::Disconnected) => return Err(UpdateError::Aborted),
        }
    }

    emit(&state("applying"));
    match install(start, env, &stage, &new_files) {
        Ok(()) => {
            write_result(&start.work_dir, &serde_json::json!({ "ok": true, "version": rel.version }));
            let _ = fs::remove_dir_all(start.app_dir.join(apply::STAGE_DIR));
            download::discard(&start.work_dir, asset);
            emit(&Event::Done { version: rel.version.clone() });
            Ok(())
        }
        Err(e) => {
            start.log.error(&format!("la instalacion fallo ({}): {e}; la version anterior queda como estaba", e.code()));
            // La app ya se cerro: se deja el aviso para el proximo arranque y se vuelve a abrir la version anterior.
            write_result(&start.work_dir, &serde_json::json!({ "ok": false, "version": rel.version, "code": e.code(), "message": e.to_string() }));
            let _ = fs::remove_dir_all(start.app_dir.join(apply::STAGE_DIR));
            if env.relaunch {
                let _ = apply::relaunch(&start.app_dir, &env.main_exe);
            }
            Err(e)
        }
    }
}

fn install(start: &Start, env: &Env, stage: &Path, new_files: &[String]) -> Result<()> {
    install_into(&start.app_dir, stage, new_files, env, &start.log)
}

/// Reemplaza los archivos de `app_dir` por los de `stage` (ya validada): espera a que se cierre el `.exe`, guarda lo antiguo,
/// relanza la app y, si todo va bien, borra la copia. Si algo falla, lo deja como estaba.
fn install_into(app_dir: &Path, stage: &Path, new_files: &[String], env: &Env, log: &Log) -> Result<()> {
    let old = apply::installed_files(app_dir);
    let exe = app_dir.join(&env.main_exe);
    log.info(&format!("esperando a que {} se pueda reemplazar (hasta {} s)", exe.display(), env.apply_wait.as_secs()));
    apply::wait_until_writable(&exe, env.apply_wait, env.swap.poll)?;
    let tag = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0).to_string();
    log.info(&format!("reemplazando: {} archivos nuevos, {} de la version instalada (los que ya no existan se retiran)", new_files.len(), old.len()));
    let mut swapped = apply::swap(app_dir, stage, new_files, &old, &env.main_exe, &tag, &env.swap)?;
    log.info(&format!("archivos reemplazados; copia de lo antiguo en {}", swapped.backup_dir().display()));
    if env.relaunch {
        if let Err(e) = apply::relaunch(app_dir, &env.main_exe) {
            log.error(&format!("no se pudo relanzar {}: {e}; se restaura la version anterior", env.main_exe));
            let _ = swapped.rollback();
            return Err(e);
        }
        log.info(&format!("{} relanzado", env.main_exe));
    }
    swapped.commit();
    log.info("copia de seguridad eliminada; instalacion completada");
    Ok(())
}

/// Instala un zip YA descargado (sin red): extrae, valida contra `CONTENIDO.sha256` y reemplaza, con exactamente el mismo
/// codigo que la fase final de una actualizacion normal. Lo usa `PESHeX-Updater apply-local` (pruebas y recuperacion a mano).
/// Devuelve cuantos archivos tiene el paquete.
pub fn apply_local(zip: &Path, app_dir: &Path, env: &Env, log: &Log) -> Result<usize> {
    apply::check_writable(app_dir)?;
    apply::cleanup_leftovers(app_dir);
    let stage = app_dir.join(apply::STAGE_DIR).join("stage");
    let _ = fs::remove_dir_all(&stage);
    let files = match apply::extract(zip, &stage, &env.limits).and_then(|_| apply::validate(&stage, &env.main_exe)) {
        Ok(f) => f,
        Err(e) => {
            let _ = fs::remove_dir_all(app_dir.join(apply::STAGE_DIR));
            return Err(e);
        }
    };
    log.info(&format!("paquete local preparado y validado: {} archivos", files.len()));
    let result = install_into(app_dir, &stage, &files, env, log);
    let _ = fs::remove_dir_all(app_dir.join(apply::STAGE_DIR));
    result.map(|()| files.len())
}

fn write_result(work_dir: &Path, value: &serde_json::Value) {
    let _ = fs::write(work_dir.join(RESULT_FILE), value.to_string());
}
