//! Una actualizacion completa por el protocolo JSON (stdin/stdout) contra un servidor local.

mod support;

use peshex_updater::apply::{self, Limits, SwapOptions};
use peshex_updater::download;
use peshex_updater::github::{Asset, ReleaseInfo};
use peshex_updater::http::{HostPolicy, Http};
use peshex_updater::session::{self, Emit, Env, Event};
use peshex_updater::sums::sha256_bytes;
use std::fs;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use support::{blob, make_zip, serve, Reply, Server};

const TOP: &str = "PESHeX-1.2.0-windows-x64";
const ZIP_NAME: &str = "PESHeX-1.2.0-windows-x64.zip";

/// stdin simulado: lo que se envia por el canal; al soltar el emisor llega EOF.
struct ChanReader {
    rx: Receiver<Vec<u8>>,
    buf: Vec<u8>,
}

impl Read for ChanReader {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if self.buf.is_empty() {
            match self.rx.recv() {
                Ok(b) => self.buf = b,
                Err(_) => return Ok(0),
            }
        }
        let n = out.len().min(self.buf.len());
        out[..n].copy_from_slice(&self.buf[..n]);
        self.buf.drain(..n);
        Ok(n)
    }
}

struct Fixture {
    root: tempfile::TempDir,
    app: PathBuf,
    work: PathBuf,
    server: Server,
    zip_len: usize,
}

/// Paquete 1.2.0 (con la huella que se indique en SHA256SUMS) y una instalacion 1.1.0 en `app/`.
fn fixture(zip_entries: Vec<(String, Vec<u8>)>, sums_hash: Option<&str>, slow: bool) -> Fixture {
    let root = tempfile::tempdir().unwrap();
    let app = root.path().join("Mi Carpeta ñandú").join("PESHeX");
    let work = root.path().join("work");
    fs::create_dir_all(&app).unwrap();
    fs::write(app.join("PESHeX.exe"), "exe 1.1.0").unwrap();
    fs::write(app.join("viejo.txt"), "solo en la 1.1.0").unwrap();
    fs::write(app.join("usuario.txt"), "mio").unwrap();
    fs::write(app.join("CONTENIDO.sha256"), format!("{} *PESHeX.exe\n{} *viejo.txt\n", sha256_bytes(b"exe 1.1.0"), sha256_bytes(b"solo en la 1.1.0"))).unwrap();

    let zip_path = root.path().join("srv.zip");
    let entries: Vec<(String, &[u8])> = zip_entries.iter().map(|(n, d)| (n.clone(), d.as_slice())).collect();
    let borrowed: Vec<(&str, &[u8])> = entries.iter().map(|(n, d)| (n.as_str(), *d)).collect();
    make_zip(&zip_path, &borrowed);
    let zip = fs::read(&zip_path).unwrap();
    let sums = format!("{} *{}\n", sums_hash.map(String::from).unwrap_or_else(|| sha256_bytes(&zip)), ZIP_NAME);
    let zip_len = zip.len();
    let delay = if slow { Duration::from_millis(15) } else { Duration::ZERO };
    let server = serve(move |req, _| match req.path.as_str() {
        "/sums" => Reply::text(200, &sums),
        "/zip" => Reply::bytes(req, &zip, 8 * 1024, delay, None, false),
        _ => Reply::text(404, ""),
    });
    Fixture { root, app, work, server, zip_len }
}

/// Entradas de un paquete valido de la 1.2.0 (con CONTENIDO.sha256 correcto).
fn good_entries() -> Vec<(String, Vec<u8>)> {
    good_entries_sized(30_000)
}

/// Igual, con el archivo grande (`ruby/lib/a.rb`) del tamaño pedido: sirve para tener descargas lentas.
fn good_entries_sized(big: usize) -> Vec<(String, Vec<u8>)> {
    let files: Vec<(&str, Vec<u8>)> = vec![("PESHeX.exe", b"exe 1.2.0".to_vec()), ("PESHeX-Updater.exe", b"upd".to_vec()), ("ruby/lib/a.rb", blob(big)), ("LEEME.txt", b"hola".to_vec())];
    let mut manifest = String::new();
    let mut out = Vec::new();
    for (n, d) in &files {
        manifest.push_str(&format!("{} *{}\n", sha256_bytes(d), n));
        out.push((format!("{TOP}/{n}"), d.clone()));
    }
    out.push((format!("{TOP}/CONTENIDO.sha256"), manifest.into_bytes()));
    out
}

fn release(f: &Fixture) -> ReleaseInfo {
    ReleaseInfo {
        tag: "v1.2.0".into(),
        version: "1.2.0".into(),
        name: "PESHeX 1.2.0".into(),
        notes: String::new(),
        url: String::new(),
        published_at: None,
        prerelease: false,
        asset: Asset { name: ZIP_NAME.into(), url: f.server.url("/zip"), size: f.zip_len as u64 },
        sums_url: f.server.url("/sums"),
    }
}

fn env() -> Env {
    Env {
        http: Http::new(HostPolicy::local_for_tests()),
        download: download::Options { max_retries: 2, backoff: Duration::from_millis(10), progress_every: Duration::from_millis(5) },
        swap: SwapOptions { lock_wait: Duration::from_millis(200), poll: Duration::from_millis(10) },
        limits: Limits::default(),
        main_exe: "PESHeX.exe".into(),
        relaunch: false,
        apply_wait: Duration::from_millis(500),
    }
}

struct Run {
    tx: Option<Sender<Vec<u8>>>,
    events: Arc<Mutex<Vec<Event>>>,
    handle: Option<thread::JoinHandle<i32>>,
}

impl Run {
    fn start(f: &Fixture) -> Run {
        let (tx, rx) = channel::<Vec<u8>>();
        let events = Arc::new(Mutex::new(Vec::new()));
        let e2 = events.clone();
        let emit: Emit = Arc::new(move |ev: &Event| e2.lock().unwrap().push(ev.clone()));
        let handle = thread::spawn(move || session::run(BufReader::new(ChanReader { rx, buf: Vec::new() }), emit, env()));
        let run = Run { tx: Some(tx), events, handle: Some(handle) };
        run.send(&serde_json::json!({ "cmd": "start", "release": release(f), "appDir": f.app, "workDir": f.work }));
        run
    }
    fn send(&self, v: &serde_json::Value) {
        self.tx.as_ref().unwrap().send(format!("{v}\n").into_bytes()).unwrap();
    }
    fn cmd(&self, c: &str) {
        self.send(&serde_json::json!({ "cmd": c }));
    }
    fn has_state(&self, s: &str) -> bool {
        self.events.lock().unwrap().iter().any(|e| matches!(e, Event::State { state } if state == s))
    }
    fn wait_state(&self, s: &str) {
        self.wait(&format!("estado {s}"), || self.has_state(s));
    }
    fn wait(&self, what: &str, f: impl Fn() -> bool) {
        let t = Instant::now();
        while !f() {
            assert!(t.elapsed() < Duration::from_secs(30), "tiempo agotado esperando {what}; eventos: {:?}", self.events.lock().unwrap());
            thread::sleep(Duration::from_millis(5));
        }
    }
    fn progress_events(&self) -> usize {
        self.events.lock().unwrap().iter().filter(|e| matches!(e, Event::Progress { .. })).count()
    }
    fn finish(mut self) -> (i32, Vec<Event>) {
        let code = self.handle.take().unwrap().join().unwrap();
        let ev = self.events.lock().unwrap().clone();
        (code, ev)
    }
    fn close_input(&mut self) {
        self.tx = None;
    }
}

fn read(p: &Path) -> String {
    String::from_utf8(fs::read(p).unwrap()).unwrap()
}

fn error_code(events: &[Event]) -> Option<String> {
    events.iter().find_map(|e| if let Event::Error { code, .. } = e { Some(code.clone()) } else { None })
}

#[test]
fn flujo_completo_descarga_verifica_prepara_y_reemplaza() {
    let f = fixture(good_entries(), None, false);
    let run = Run::start(&f);
    run.wait_state("ready");
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.1.0", "hasta ordenar `apply` no se toca nada");
    run.cmd("apply");
    let (code, events) = run.finish();
    assert_eq!(code, 0, "{events:?}");

    // Orden de los estados y eventos
    let states: Vec<&str> = events.iter().filter_map(|e| if let Event::State { state } = e { Some(state.as_str()) } else { None }).collect();
    assert_eq!(states, vec!["downloading", "verifying", "extracting", "ready", "applying"]);
    assert!(events.iter().any(|e| matches!(e, Event::Verified { sha256 } if sha256.len() == 64)));
    assert!(events.iter().any(|e| matches!(e, Event::Progress { downloaded, total, .. } if downloaded == total && *total == f.zip_len as u64)));
    assert!(matches!(events.last(), Some(Event::Done { version }) if version == "1.2.0"));

    // Resultado en disco
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.2.0");
    assert_eq!(read(&f.app.join("PESHeX-Updater.exe")), "upd");
    assert!(f.app.join("ruby/lib/a.rb").exists());
    assert!(!f.app.join("viejo.txt").exists(), "lo que la 1.2.0 ya no trae se retira");
    assert_eq!(read(&f.app.join("usuario.txt")), "mio");
    assert_eq!(apply::list_files(&f.app).unwrap().iter().filter(|n| n.starts_with('.')).count(), 0, "sin carpetas de preparacion ni copias");
    assert!(!f.work.join(ZIP_NAME).exists(), "el zip descargado se borra");
    let res: serde_json::Value = serde_json::from_str(&read(&f.work.join(session::RESULT_FILE))).unwrap();
    assert_eq!(res["ok"], true);
    assert_eq!(res["version"], "1.2.0");

    // El registro de diagnostico cuenta todo el camino (para poder saber que paso si falla en otro equipo)
    let log = read(&f.work.join(session::LOG_FILE));
    for needle in ["inicio: PESHeX-Updater", "estado: downloading", "huella esperada", "huella SHA-256 verificada", "estado: extracting", "paquete preparado y validado", "estado: ready", "estado: applying", "esperando a que", "reemplazando:", "instalacion completada", "terminada"] {
        assert!(log.contains(needle), "falta «{needle}» en el registro:\n{log}");
    }
    assert!(log.lines().all(|l| l.contains("[updater]") && l.len() > 25), "{log}");
    assert!(log.contains("descarga:"), "el progreso se anota (de 10 en 10 %)");
    assert!(log.lines().filter(|l| l.contains("descarga:")).count() <= 12, "pero no cada 150 ms:\n{log}");
}

#[test]
fn una_huella_distinta_se_rechaza_y_no_se_instala_nada() {
    let f = fixture(good_entries(), Some(&"0".repeat(64)), false);
    let run = Run::start(&f);
    let (code, events) = run.finish();
    assert_eq!(code, 1);
    assert_eq!(error_code(&events).as_deref(), Some("hash_mismatch"));
    assert!(read(&f.work.join(session::LOG_FILE)).contains("ERROR [updater] hash_mismatch"), "el error queda en el registro");
    assert!(!events.iter().any(|e| matches!(e, Event::Verified { .. })));
    assert!(!f.work.join(ZIP_NAME).exists(), "el zip corrupto se borra");
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.1.0");
    assert!(!f.app.join(apply::STAGE_DIR).exists());
}

#[test]
fn sin_huella_del_zip_en_sha256sums_no_se_instala() {
    let f = fixture(good_entries(), None, false);
    // SHA256SUMS sin el zip: se reemplaza el servidor por uno que lista otro archivo.
    let sums = format!("{} *otro.zip\n", "a".repeat(64));
    let srv = serve(move |_, _| Reply::text(200, &sums));
    let mut rel = release(&f);
    rel.sums_url = srv.url("/s");
    let (tx, rx) = channel::<Vec<u8>>();
    let events = Arc::new(Mutex::new(Vec::new()));
    let e2 = events.clone();
    let emit: Emit = Arc::new(move |ev: &Event| e2.lock().unwrap().push(ev.clone()));
    tx.send(format!("{}\n", serde_json::json!({ "cmd": "start", "release": rel, "appDir": f.app, "workDir": f.work })).into_bytes()).unwrap();
    let code = session::run(BufReader::new(ChanReader { rx, buf: Vec::new() }), emit, env());
    assert_eq!(code, 1);
    assert_eq!(error_code(&events.lock().unwrap()).as_deref(), Some("no_checksum"));
    drop(tx);
}

#[test]
fn un_zip_con_rutas_peligrosas_no_toca_nada_y_se_descarta() {
    let mut entries = good_entries();
    entries.push((format!("{TOP}/../../fuera.txt"), b"mal".to_vec()));
    let f = fixture(entries, None, false);
    let run = Run::start(&f);
    let (code, events) = run.finish();
    assert_eq!(code, 1);
    assert_eq!(error_code(&events).as_deref(), Some("bad_archive"));
    assert!(!f.root.path().join("fuera.txt").exists() && !f.root.path().join("Mi Carpeta ñandú").join("fuera.txt").exists());
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.1.0");
    assert!(!f.work.join(ZIP_NAME).exists(), "un paquete que no sirve no se conserva");
}

#[test]
fn un_paquete_cuyo_contenido_no_coincide_con_su_manifiesto_se_rechaza() {
    let mut entries = good_entries();
    for e in entries.iter_mut() {
        if e.0.ends_with("/PESHeX.exe") {
            e.1 = b"exe manipulado".to_vec(); // la huella del manifiesto ya no coincide
        }
    }
    let f = fixture(entries, None, false);
    let (code, events) = Run::start(&f).finish();
    assert_eq!(code, 1);
    assert_eq!(error_code(&events).as_deref(), Some("bad_archive"));
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.1.0");
    assert!(!f.app.join(apply::STAGE_DIR).exists(), "la carpeta de preparacion se limpia");
}

#[test]
fn cancelar_en_plena_descarga_borra_todo() {
    let f = fixture(good_entries_sized(400_000), None, true);
    let run = Run::start(&f);
    run.wait("algo de progreso", || run.progress_events() >= 3);
    run.cmd("pause");
    run.wait_state("paused");
    run.cmd("cancel");
    let (code, events) = run.finish();
    assert_eq!(code, 0);
    assert!(matches!(events.last(), Some(Event::State { state }) if state == "cancelled"));
    // (salvo el registro de diagnostico, que se conserva a proposito)
    let left: Vec<_> = fs::read_dir(&f.work).map(|d| d.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n != session::LOG_FILE).collect()).unwrap_or_default();
    assert!(left.is_empty(), "no queda nada en la carpeta de descargas: {left:?}");
    assert!(read(&f.work.join(session::LOG_FILE)).contains("cancelado por el usuario"));
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.1.0");
}

#[test]
fn pausar_y_reanudar_no_altera_el_resultado() {
    let f = fixture(good_entries_sized(300_000), None, true);
    let run = Run::start(&f);
    run.wait("algo de progreso", || run.progress_events() >= 3);
    run.cmd("pause");
    run.wait_state("paused");
    thread::sleep(Duration::from_millis(150));
    let frozen = run.progress_events();
    thread::sleep(Duration::from_millis(300));
    assert_eq!(run.progress_events(), frozen);
    run.cmd("resume");
    run.wait_state("ready");
    run.cmd("apply");
    let (code, _) = run.finish();
    assert_eq!(code, 0);
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.2.0");
}

#[test]
fn si_la_app_se_cierra_durante_la_descarga_se_conserva_y_otra_sesion_continua() {
    let f = fixture(good_entries_sized(300_000), None, true);
    let mut run = Run::start(&f);
    run.wait("algo de progreso", || run.progress_events() >= 3);
    run.close_input(); // EOF en stdin
    let (code, events) = run.finish();
    assert_eq!(code, 0, "salir asi no es un error: {events:?}");
    assert!(error_code(&events).is_none());
    let part = f.work.join(format!("{ZIP_NAME}.part"));
    assert!(part.exists(), "lo descargado se conserva");
    let kept = fs::metadata(&part).unwrap().len();

    let run2 = Run::start(&f);
    run2.wait_state("ready");
    run2.cmd("apply");
    let (code, _) = run2.finish();
    assert_eq!(code, 0);
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.2.0");
    assert_eq!(f.server.requests().iter().filter_map(|r| r.range_from()).max(), Some(kept), "la segunda sesion pidio solo el resto");
}

#[test]
fn si_la_app_se_cierra_tras_ordenar_instalar_la_instalacion_termina() {
    let f = fixture(good_entries(), None, false);
    let mut run = Run::start(&f);
    run.wait_state("ready");
    run.cmd("apply");
    run.close_input(); // la app sale justo despues: no debe interrumpir la instalacion
    let (code, events) = run.finish();
    assert_eq!(code, 0, "{events:?}");
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.2.0");
}

#[test]
fn si_el_reemplazo_falla_queda_la_version_anterior_y_un_aviso() {
    let mut entries = good_entries();
    // El paquete quiere una carpeta `docs/` pero en la instalacion `docs` es un archivo.
    let extra = ("docs/ayuda.txt", b"ayuda".to_vec());
    let mut manifest = String::new();
    for (n, d) in entries.iter().filter(|(n, _)| !n.ends_with("CONTENIDO.sha256")) {
        manifest.push_str(&format!("{} *{}\n", sha256_bytes(d), n.trim_start_matches(&format!("{TOP}/"))));
    }
    manifest.push_str(&format!("{} *{}\n", sha256_bytes(&extra.1), extra.0));
    entries.retain(|(n, _)| !n.ends_with("CONTENIDO.sha256"));
    entries.push((format!("{TOP}/{}", extra.0), extra.1));
    entries.push((format!("{TOP}/CONTENIDO.sha256"), manifest.into_bytes()));
    let f = fixture(entries, None, false);
    fs::write(f.app.join("docs"), "soy un archivo").unwrap();
    let before = apply::list_files(&f.app).unwrap();

    let run = Run::start(&f);
    run.wait_state("ready");
    run.cmd("apply");
    let (code, events) = run.finish();
    assert_eq!(code, 1, "{events:?}");
    assert!(error_code(&events).is_some());
    assert_eq!(apply::list_files(&f.app).unwrap(), before, "la instalacion queda como estaba");
    assert_eq!(read(&f.app.join("PESHeX.exe")), "exe 1.1.0");
    let log = read(&f.work.join(session::LOG_FILE));
    assert!(log.contains("ERROR [updater] la instalacion fallo"), "el fallo del reemplazo queda en el registro:\n{log}");
    let res: serde_json::Value = serde_json::from_str(&read(&f.work.join(session::RESULT_FILE))).unwrap();
    assert_eq!(res["ok"], false, "la app que arranque despues lo mostrara");
    assert!(res["message"].as_str().unwrap().len() > 3);
}

#[test]
fn rechaza_un_nombre_de_paquete_que_no_corresponde_a_la_version() {
    let f = fixture(good_entries(), None, false);
    let mut rel = release(&f);
    rel.asset.name = "../../escape.zip".into();
    let (tx, rx) = channel::<Vec<u8>>();
    let events = Arc::new(Mutex::new(Vec::new()));
    let e2 = events.clone();
    let emit: Emit = Arc::new(move |ev: &Event| e2.lock().unwrap().push(ev.clone()));
    tx.send(format!("{}\n", serde_json::json!({ "cmd": "start", "release": rel, "appDir": f.app, "workDir": f.work })).into_bytes()).unwrap();
    assert_eq!(session::run(BufReader::new(ChanReader { rx, buf: Vec::new() }), emit, env()), 1);
    assert_eq!(error_code(&events.lock().unwrap()).as_deref(), Some("invalid"));
    assert_eq!(f.server.hits.load(std::sync::atomic::Ordering::SeqCst), 0, "ni siquiera se conecta");
    drop(tx);
}

#[test]
fn eof_antes_de_start_termina_sin_hacer_nada() {
    let (tx, rx) = channel::<Vec<u8>>();
    drop(tx);
    let emit: Emit = Arc::new(|_| panic!("no debe emitir nada"));
    assert_eq!(session::run(BufReader::new(ChanReader { rx, buf: Vec::new() }), emit, env()), 0);
}
