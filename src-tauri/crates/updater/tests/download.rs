//! Descarga reanudable: Range, cortes de red, pausa/reanudacion, cancelacion y tamaño.

mod support;

use peshex_updater::download::{download, Control, DlEvent, Options};
use peshex_updater::http::{HostPolicy, Http};
use peshex_updater::UpdateError;
use std::fs;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use support::{blob, serve, Reply};

fn http() -> Http {
    Http::new(HostPolicy::local_for_tests())
}

fn opts() -> Options {
    Options { max_retries: 3, backoff: Duration::from_millis(10), progress_every: Duration::from_millis(5) }
}

fn quiet(_: DlEvent) {}

#[test]
fn descarga_completa() {
    let data = blob(300_000);
    let d2 = data.clone();
    let s = serve(move |req, _| Reply::bytes(req, &d2, 64 * 1024, Duration::ZERO, None, false));
    let dir = tempfile::tempdir().unwrap();
    let mut events = Vec::new();
    let p = download(&http(), &s.url("/a.zip"), data.len() as u64, dir.path(), "a.zip", &Control::new(), &opts(), &mut |e| events.push(e)).unwrap();
    assert_eq!(fs::read(&p).unwrap(), data);
    assert!(!dir.path().join("a.zip.part").exists() && !dir.path().join("a.zip.part.json").exists(), "no quedan restos");
    let DlEvent::Progress(last) = events.last().copied().unwrap() else { panic!() };
    assert_eq!((last.downloaded, last.total), (300_000, 300_000));
}

#[test]
fn reanuda_un_part_anterior_con_range() {
    let data = blob(400_000);
    let d2 = data.clone();
    let s = serve(move |req, _| Reply::bytes(req, &d2, 64 * 1024, Duration::ZERO, None, false));
    let dir = tempfile::tempdir().unwrap();
    let url = s.url("/a.zip");
    fs::write(dir.path().join("a.zip.part"), &data[..150_000]).unwrap();
    fs::write(dir.path().join("a.zip.part.json"), serde_json::json!({ "url": url, "size": data.len() }).to_string()).unwrap();
    let p = download(&http(), &url, data.len() as u64, dir.path(), "a.zip", &Control::new(), &opts(), &mut quiet).unwrap();
    assert_eq!(fs::read(&p).unwrap(), data);
    let reqs = s.requests();
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].header("range"), Some("bytes=150000-"), "solo se pide lo que falta");
}

#[test]
fn un_part_de_otra_url_o_tamaño_se_descarta() {
    let data = blob(100_000);
    let d2 = data.clone();
    let s = serve(move |req, _| Reply::bytes(req, &d2, 64 * 1024, Duration::ZERO, None, false));
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.zip.part"), b"basura de otra descarga").unwrap();
    fs::write(dir.path().join("a.zip.part.json"), r#"{"url":"http://otro/","size":5}"#).unwrap();
    let p = download(&http(), &s.url("/a.zip"), data.len() as u64, dir.path(), "a.zip", &Control::new(), &opts(), &mut quiet).unwrap();
    assert_eq!(fs::read(&p).unwrap(), data);
    assert!(s.requests()[0].header("range").is_none());
}

#[test]
fn servidor_sin_range_reinicia_desde_cero() {
    let data = blob(200_000);
    let d2 = data.clone();
    let s = serve(move |req, _| Reply::bytes(req, &d2, 64 * 1024, Duration::ZERO, None, true));
    let dir = tempfile::tempdir().unwrap();
    let url = s.url("/a.zip");
    fs::write(dir.path().join("a.zip.part"), &data[..50_000]).unwrap();
    fs::write(dir.path().join("a.zip.part.json"), serde_json::json!({ "url": url, "size": data.len() }).to_string()).unwrap();
    let p = download(&http(), &url, data.len() as u64, dir.path(), "a.zip", &Control::new(), &opts(), &mut quiet).unwrap();
    assert_eq!(fs::read(&p).unwrap(), data, "sin duplicar los primeros bytes");
}

#[test]
fn si_se_corta_la_conexion_se_reanuda_donde_quedo() {
    let data = blob(600_000);
    let d2 = data.clone();
    // La primera conexion se corta a los ~200 KB; la segunda sirve el resto.
    let s = serve(move |req, n| Reply::bytes(req, &d2, 32 * 1024, Duration::ZERO, if n == 0 { Some(200_000) } else { None }, false));
    let dir = tempfile::tempdir().unwrap();
    let p = download(&http(), &s.url("/a.zip"), data.len() as u64, dir.path(), "a.zip", &Control::new(), &opts(), &mut quiet).unwrap();
    assert_eq!(fs::read(&p).unwrap(), data);
    let reqs = s.requests();
    assert!(reqs.len() >= 2);
    assert!(reqs[1].range_from().unwrap() >= 200_000 - 32 * 1024, "la segunda peticion es con Range: {:?}", reqs[1].header("range"));
}

#[test]
fn errores_5xx_se_reintentan_y_luego_se_rinde() {
    let s = serve(|_, _| Reply::text(503, "no"));
    let dir = tempfile::tempdir().unwrap();
    let r = download(&http(), &s.url("/a.zip"), 1000, dir.path(), "a.zip", &Control::new(), &opts(), &mut quiet);
    assert!(matches!(r, Err(UpdateError::Http(503))), "{r:?}");
    assert_eq!(s.hits.load(std::sync::atomic::Ordering::SeqCst), 4, "1 intento + 3 reintentos");
    assert!(dir.path().join("a.zip.part").exists(), "lo bajado se conserva para reanudar");
}

#[test]
fn un_404_no_se_reintenta() {
    let s = serve(|_, _| Reply::text(404, "no"));
    let dir = tempfile::tempdir().unwrap();
    let r = download(&http(), &s.url("/a.zip"), 1000, dir.path(), "a.zip", &Control::new(), &opts(), &mut quiet);
    assert!(matches!(r, Err(UpdateError::NoRelease)), "{r:?}");
    assert_eq!(s.hits.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn tamaño_distinto_al_anunciado_se_rechaza() {
    let data = blob(50_000);
    let d2 = data.clone();
    let s = serve(move |req, _| Reply::bytes(req, &d2, 16 * 1024, Duration::ZERO, None, false));
    let dir = tempfile::tempdir().unwrap();
    let r = download(&http(), &s.url("/a.zip"), 10_000, dir.path(), "a.zip", &Control::new(), &opts(), &mut quiet);
    assert!(matches!(r, Err(UpdateError::SizeMismatch { .. })), "{r:?}");
    assert!(!dir.path().join("a.zip.part").exists(), "el resto se borra");
}

/// Descarga lenta en un hilo; devuelve el mando, los eventos y el hilo.
fn slow_download(
    data: Vec<u8>,
    dir: std::path::PathBuf,
) -> (Control, Arc<Mutex<Vec<DlEvent>>>, thread::JoinHandle<Result<std::path::PathBuf, UpdateError>>, support::Server) {
    let d2 = data.clone();
    let s = serve(move |req, _| Reply::bytes(req, &d2, 8 * 1024, Duration::from_millis(15), None, false));
    let control = Control::new();
    let events = Arc::new(Mutex::new(Vec::new()));
    let (c2, e2, url, size) = (control.clone(), events.clone(), s.url("/a.zip"), data.len() as u64);
    let h = thread::spawn(move || download(&http(), &url, size, &dir, "a.zip", &c2, &opts(), &mut |e| e2.lock().unwrap().push(e)));
    (control, events, h, s)
}

fn progress_count(e: &Mutex<Vec<DlEvent>>) -> usize {
    e.lock().unwrap().iter().filter(|e| matches!(e, DlEvent::Progress(_))).count()
}

fn wait_for(what: &str, mut f: impl FnMut() -> bool) {
    let t = Instant::now();
    while !f() {
        assert!(t.elapsed() < Duration::from_secs(20), "tiempo agotado esperando: {what}");
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn pausa_detiene_y_reanudar_termina_bien() {
    let data = blob(200_000);
    let dir = tempfile::tempdir().unwrap();
    let (control, events, h, _s) = slow_download(data.clone(), dir.path().to_path_buf());
    wait_for("primeros bytes", || progress_count(&events) >= 3);
    control.pause();
    wait_for("evento de pausa", || events.lock().unwrap().contains(&DlEvent::Paused));
    thread::sleep(Duration::from_millis(100)); // deja que se vacie lo que iba en vuelo
    let frozen = progress_count(&events);
    let size_at_pause = fs::metadata(dir.path().join("a.zip.part")).unwrap().len();
    thread::sleep(Duration::from_millis(400));
    assert_eq!(progress_count(&events), frozen, "en pausa no hay progreso");
    assert_eq!(fs::metadata(dir.path().join("a.zip.part")).unwrap().len(), size_at_pause, "ni se escribe al disco");
    assert!(size_at_pause < data.len() as u64, "la pausa llego antes del final");
    assert!(!h.is_finished());
    control.resume();
    let p = h.join().unwrap().unwrap();
    assert_eq!(fs::read(p).unwrap(), data, "el archivo queda identico tras pausar y reanudar");
    assert!(events.lock().unwrap().contains(&DlEvent::Resumed));
}

#[test]
fn cancelar_borra_lo_descargado() {
    let data = blob(200_000);
    let dir = tempfile::tempdir().unwrap();
    let (control, events, h, _s) = slow_download(data, dir.path().to_path_buf());
    wait_for("primeros bytes", || progress_count(&events) >= 2);
    control.cancel();
    assert!(matches!(h.join().unwrap(), Err(UpdateError::Cancelled)));
    assert!(!dir.path().join("a.zip.part").exists() && !dir.path().join("a.zip.part.json").exists() && !dir.path().join("a.zip").exists());
}

#[test]
fn cancelar_en_pausa_tambien_funciona() {
    let data = blob(200_000);
    let dir = tempfile::tempdir().unwrap();
    let (control, events, h, _s) = slow_download(data, dir.path().to_path_buf());
    wait_for("primeros bytes", || progress_count(&events) >= 2);
    control.pause();
    wait_for("pausa", || events.lock().unwrap().contains(&DlEvent::Paused));
    control.cancel();
    assert!(matches!(h.join().unwrap(), Err(UpdateError::Cancelled)));
    assert!(!dir.path().join("a.zip.part").exists());
}

#[test]
fn salir_conserva_lo_descargado_y_se_puede_continuar() {
    let data = blob(200_000);
    let dir = tempfile::tempdir().unwrap();
    let (control, events, h, s) = slow_download(data.clone(), dir.path().to_path_buf());
    wait_for("primeros bytes", || progress_count(&events) >= 3);
    control.abort();
    assert!(matches!(h.join().unwrap(), Err(UpdateError::Aborted)));
    let kept = fs::metadata(dir.path().join("a.zip.part")).unwrap().len();
    assert!(kept > 0 && kept < data.len() as u64);
    // Otra sesion continua desde ahi.
    let p = download(&http(), &s.url("/a.zip"), data.len() as u64, dir.path(), "a.zip", &Control::new(), &opts(), &mut quiet).unwrap();
    assert_eq!(fs::read(p).unwrap(), data);
    assert_eq!(s.requests().last().unwrap().range_from(), Some(kept));
}

#[test]
fn un_archivo_ya_completo_no_se_vuelve_a_bajar() {
    let data = blob(10_000);
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("a.zip"), &data).unwrap();
    let s = serve(|_, _| Reply::text(500, "no deberia pedirse"));
    let p = download(&http(), &s.url("/a.zip"), data.len() as u64, dir.path(), "a.zip", &Control::new(), &opts(), &mut quiet).unwrap();
    assert_eq!(fs::read(p).unwrap(), data);
    assert_eq!(s.hits.load(std::sync::atomic::Ordering::SeqCst), 0);
}
