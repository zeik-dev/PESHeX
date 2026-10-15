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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::time::Duration;

/// Resultado del ultimo reemplazo, para que la app que arranca despues lo muestre (`<workDir>/update-result.json`).
pub const RESULT_FILE: &str = "update-result.json";

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
                        let _ = start_tx.send(Start { release: *release, app_dir, work_dir });
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
    match flow(&start, &env, &control, &apply_rx, &emit) {
        Ok(()) => 0,
        Err(UpdateError::Cancelled) => {
            emit(&state("cancelled"));
            0
        }
        Err(UpdateError::Aborted) => 0,
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
    let old = apply::installed_files(&start.app_dir);
    apply::wait_until_writable(&start.app_dir.join(&env.main_exe), env.apply_wait, env.swap.poll)?;
    let tag = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0).to_string();
    let mut swapped = apply::swap(&start.app_dir, stage, new_files, &old, &env.main_exe, &tag, &env.swap)?;
    if env.relaunch {
        if let Err(e) = apply::relaunch(&start.app_dir, &env.main_exe) {
            let _ = swapped.rollback();
            return Err(e);
        }
    }
    swapped.commit();
    Ok(())
}

fn write_result(work_dir: &Path, value: &serde_json::Value) {
    let _ = fs::write(work_dir.join(RESULT_FILE), value.to_string());
}
