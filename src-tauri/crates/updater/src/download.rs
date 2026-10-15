//! Descarga reanudable con pausa, reanudacion y cancelacion.
//!
//! Lo bajado va a `<nombre>.part` (con `<nombre>.part.json` que recuerda de que URL y de que tamaño es). Al pausar se cierra la
//! conexion y se conserva el `.part`; al reanudar (o al reiniciar el actualizador) se pide el resto con `Range`.

use crate::http::Http;
use crate::{Result, UpdateError};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Cmd {
    Run,
    Pause,
    /// Terminal: borrar lo descargado.
    Cancel,
    /// Terminal: salir conservando lo descargado (la app se cerro).
    Abort,
}

/// Mando compartido entre el hilo que lee las ordenes y el que descarga.
#[derive(Clone)]
pub struct Control(Arc<(Mutex<Cmd>, Condvar)>);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    Go,
    Cancel,
    Abort,
}

impl Default for Control {
    fn default() -> Self {
        Self::new()
    }
}

impl Control {
    pub fn new() -> Self {
        Control(Arc::new((Mutex::new(Cmd::Run), Condvar::new())))
    }

    fn set(&self, f: impl FnOnce(Cmd) -> Cmd) {
        let (m, cv) = &*self.0;
        let mut st = m.lock().unwrap_or_else(|e| e.into_inner());
        *st = f(*st);
        cv.notify_all();
    }

    pub fn pause(&self) {
        self.set(|c| if c == Cmd::Run { Cmd::Pause } else { c });
    }
    pub fn resume(&self) {
        self.set(|c| if c == Cmd::Pause { Cmd::Run } else { c });
    }
    pub fn cancel(&self) {
        self.set(|_| Cmd::Cancel);
    }
    pub fn abort(&self) {
        self.set(|c| if c == Cmd::Cancel { c } else { Cmd::Abort });
    }

    pub fn is_paused(&self) -> bool {
        *self.0 .0.lock().unwrap_or_else(|e| e.into_inner()) == Cmd::Pause
    }

    /// `true` si hay que dejar de leer YA (pausa, cancelacion o cierre).
    fn interrupted(&self) -> bool {
        *self.0 .0.lock().unwrap_or_else(|e| e.into_inner()) != Cmd::Run
    }

    pub fn state(&self) -> Gate {
        match *self.0 .0.lock().unwrap_or_else(|e| e.into_inner()) {
            Cmd::Run | Cmd::Pause => Gate::Go,
            Cmd::Cancel => Gate::Cancel,
            Cmd::Abort => Gate::Abort,
        }
    }

    /// Si esta en pausa bloquea hasta reanudar (avisando con `on_change(true)` al pausar y `on_change(false)` al reanudar);
    /// devuelve que hacer despues.
    pub fn gate(&self, on_change: &mut dyn FnMut(bool)) -> Gate {
        let (m, cv) = &*self.0;
        let mut st = m.lock().unwrap_or_else(|e| e.into_inner());
        let paused = *st == Cmd::Pause;
        if paused {
            on_change(true);
        }
        while *st == Cmd::Pause {
            st = cv.wait(st).unwrap_or_else(|e| e.into_inner());
        }
        match *st {
            Cmd::Run => {
                if paused {
                    on_change(false);
                }
                Gate::Go
            }
            Cmd::Cancel => Gate::Cancel,
            Cmd::Abort => Gate::Abort,
            Cmd::Pause => unreachable!(),
        }
    }

    /// Duerme `dur` pero despierta antes si llega una orden.
    fn sleep(&self, dur: Duration) {
        let (m, cv) = &*self.0;
        let st = m.lock().unwrap_or_else(|e| e.into_inner());
        if *st == Cmd::Run {
            let _ = cv.wait_timeout(st, dur);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub downloaded: u64,
    pub total: u64,
    pub bytes_per_sec: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DlEvent {
    Progress(Progress),
    Paused,
    Resumed,
}

#[derive(Debug, Clone)]
pub struct Options {
    /// Fallos de red seguidos antes de rendirse (cada reintento reanuda con `Range`).
    pub max_retries: u32,
    /// Espera tras el primer fallo; se duplica en cada reintento.
    pub backoff: Duration,
    pub progress_every: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Options { max_retries: 5, backoff: Duration::from_secs(1), progress_every: Duration::from_millis(150) }
    }
}

/// Rutas de trabajo de una descarga.
pub fn part_paths(dir: &Path, name: &str) -> (PathBuf, PathBuf, PathBuf) {
    (dir.join(name), dir.join(format!("{name}.part")), dir.join(format!("{name}.part.json")))
}

/// Borra lo descargado (zip final, `.part` y su ficha).
pub fn discard(dir: &Path, name: &str) {
    let (fin, part, meta) = part_paths(dir, name);
    for p in [fin, part, meta] {
        let _ = fs::remove_file(p);
    }
}

fn parse_content_range(h: &str) -> Option<(u64, Option<u64>)> {
    // «bytes 100-999/1000»
    let rest = h.trim().strip_prefix("bytes ")?;
    let (range, total) = rest.split_once('/')?;
    let (start, _end) = range.split_once('-')?;
    Some((start.trim().parse().ok()?, total.trim().parse().ok()))
}

/// Descarga `url` en `dir/name`. `expected_size` (0 = desconocido) se exige al terminar. Devuelve la ruta del archivo completo.
pub fn download(
    http: &Http,
    url: &str,
    expected_size: u64,
    dir: &Path,
    name: &str,
    control: &Control,
    opt: &Options,
    ev: &mut dyn FnMut(DlEvent),
) -> Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let (final_path, part, meta) = part_paths(dir, name);

    // Ya descargado antes (por ejemplo, el verificado quedo a medias): se reutiliza si el tamaño cuadra.
    if final_path.exists() {
        if expected_size == 0 || final_path.metadata()?.len() == expected_size {
            return Ok(final_path);
        }
        fs::remove_file(&final_path)?;
    }

    let want_meta = serde_json::json!({ "url": url, "size": expected_size }).to_string();
    let mut offset = 0u64;
    if part.exists() && fs::read_to_string(&meta).ok().as_deref() == Some(want_meta.as_str()) {
        offset = part.metadata()?.len();
        if expected_size > 0 && offset > expected_size {
            offset = 0;
        }
    }
    if offset == 0 {
        fs::write(&part, b"")?;
    }
    fs::write(&meta, &want_meta)?;

    let mut total = expected_size;
    let mut retries = 0u32;
    let mut last_tick = Instant::now();
    let mut tick_from = offset;
    let mut speed = 0u64;
    let mut buf = vec![0u8; 64 * 1024];
    ev(DlEvent::Progress(Progress { downloaded: offset, total, bytes_per_sec: 0 }));

    'outer: loop {
        match control.gate(&mut |paused| ev(if paused { DlEvent::Paused } else { DlEvent::Resumed })) {
            Gate::Go => {}
            Gate::Cancel => {
                discard(dir, name);
                return Err(UpdateError::Cancelled);
            }
            Gate::Abort => return Err(UpdateError::Aborted),
        }
        if expected_size > 0 && offset == expected_size {
            break;
        }

        // Si algo falla se espera (interrumpible) y se vuelve a pedir desde `offset`.
        macro_rules! retry {
            ($err:expr) => {{
                retries += 1;
                if retries > opt.max_retries {
                    return Err($err);
                }
                control.sleep(opt.backoff * 2u32.pow((retries - 1).min(6)));
                continue 'outer;
            }};
        }

        let resp = match http.get(url, Some(offset), None) {
            Ok(r) => r,
            Err(UpdateError::Http(416)) => {
                if expected_size > 0 && offset >= expected_size {
                    break;
                }
                // El servidor no reconoce el rango: se empieza de cero.
                fs::write(&part, b"")?;
                offset = 0;
                retry!(UpdateError::Http(416))
            }
            Err(e @ (UpdateError::Network(_) | UpdateError::Http(500..=599))) => retry!(e),
            Err(e) => return Err(e),
        };

        if resp.status() == 206 {
            let ok = resp.header("content-range").and_then(parse_content_range);
            match ok {
                Some((start, t)) if start == offset => {
                    if let Some(t) = t.filter(|t| *t > 0) {
                        total = t;
                    }
                }
                _ => {
                    fs::write(&part, b"")?;
                    offset = 0;
                    retry!(UpdateError::Network("el servidor devolvio un rango inesperado".into()))
                }
            }
        } else {
            // 200: el servidor ignoro `Range`; llega el archivo entero.
            if offset > 0 {
                fs::write(&part, b"")?;
                offset = 0;
                tick_from = 0;
            }
            if let Some(len) = resp.header("content-length").and_then(|l| l.parse::<u64>().ok()).filter(|l| *l > 0) {
                total = len;
            }
        }
        if expected_size > 0 && total != expected_size {
            total = expected_size;
        }

        let mut file = OpenOptions::new().write(true).open(&part)?;
        file.set_len(offset)?;
        file.seek(SeekFrom::Start(offset))?;
        let mut reader = resp.into_reader();
        let mut got_data = false;

        loop {
            if control.interrupted() {
                file.flush()?;
                continue 'outer; // la conexion se cierra al salir del ambito; el control decide (pausa/cancelar/salir)
            }
            let n = match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    file.flush()?;
                    if got_data {
                        retries = 0;
                    }
                    retry!(UpdateError::Network(e.to_string()))
                }
            };
            got_data = true;
            file.write_all(&buf[..n])?;
            offset += n as u64;
            if expected_size > 0 && offset > expected_size {
                drop(file);
                discard(dir, name);
                return Err(UpdateError::SizeMismatch { expected: expected_size, actual: offset });
            }
            let dt = last_tick.elapsed();
            if dt >= opt.progress_every {
                speed = ((offset - tick_from) as f64 / dt.as_secs_f64()) as u64;
                last_tick = Instant::now();
                tick_from = offset;
                ev(DlEvent::Progress(Progress { downloaded: offset, total, bytes_per_sec: speed }));
            }
        }
        file.sync_all()?;
        if got_data {
            retries = 0;
        }
        if total > 0 && offset < total {
            // Cierre prematuro de la conexion: se reanuda desde donde quedo.
            retry!(UpdateError::Network("la conexion se cerro antes de terminar".into()))
        }
        break;
    }

    if expected_size > 0 && offset != expected_size {
        discard(dir, name);
        return Err(UpdateError::SizeMismatch { expected: expected_size, actual: offset });
    }
    ev(DlEvent::Progress(Progress { downloaded: offset, total: offset, bytes_per_sec: speed }));
    fs::rename(&part, &final_path)?;
    let _ = fs::remove_file(&meta);
    Ok(final_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_range() {
        assert_eq!(parse_content_range("bytes 100-999/1000"), Some((100, Some(1000))));
        assert_eq!(parse_content_range("bytes 0-9/*"), Some((0, None)));
        assert_eq!(parse_content_range("items 0-9/10"), None);
    }

    #[test]
    fn el_mando_respeta_los_estados_terminales() {
        let c = Control::new();
        c.pause();
        assert!(c.is_paused());
        c.resume();
        assert!(!c.is_paused());
        c.cancel();
        c.resume();
        c.abort();
        assert_eq!(c.state(), Gate::Cancel); // cancelar no se deshace
        let c = Control::new();
        c.abort();
        c.pause();
        assert_eq!(c.state(), Gate::Abort);
    }
}
