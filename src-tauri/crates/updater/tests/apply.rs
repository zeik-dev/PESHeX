//! Extraccion segura, validacion contra CONTENIDO.sha256 y reemplazo con rollback.

mod support;

use peshex_updater::apply::{self, Limits, SwapOptions};
use peshex_updater::sums::sha256_bytes;
use peshex_updater::UpdateError;
use std::fs;
use std::path::Path;
use std::time::Duration;
use support::make_zip;

fn put(root: &Path, rel: &str, data: &[u8]) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, data).unwrap();
}

fn read(root: &Path, rel: &str) -> String {
    String::from_utf8(fs::read(root.join(rel)).unwrap()).unwrap()
}

/// Paquete valido: archivos + CONTENIDO.sha256 con sus huellas.
fn package(root: &Path, files: &[(&str, &str)]) {
    let mut manifest = String::new();
    for (name, data) in files {
        put(root, name, data.as_bytes());
        manifest.push_str(&format!("{} *{}\n", sha256_bytes(data.as_bytes()), name));
    }
    put(root, apply::MANIFEST, manifest.as_bytes());
}

fn fast() -> SwapOptions {
    SwapOptions { lock_wait: Duration::from_millis(200), poll: Duration::from_millis(10) }
}

#[test]
fn nombres_peligrosos_se_rechazan() {
    for bad in ["../evil.txt", "a/../../evil", "/abs/x", "C:/Windows/x", "a\\b", "a/b:stream", "con.", "x /y", "", "./", "a\0b"] {
        assert!(matches!(apply::safe_rel(bad), Err(UpdateError::BadArchive(_))), "{bad:?}");
    }
    assert_eq!(apply::safe_rel("ruby/lib/./a.rb").unwrap(), "ruby/lib/a.rb");
    assert_eq!(apply::safe_rel("PESHeX.exe").unwrap(), "PESHeX.exe");
    assert_eq!(apply::safe_rel("rxdata/Año 1/ñandú.rb").unwrap(), "rxdata/Año 1/ñandú.rb");
}

#[test]
fn extrae_quitando_la_carpeta_raiz() {
    let dir = tempfile::tempdir().unwrap();
    let zip = dir.path().join("p.zip");
    make_zip(&zip, &[("PESHeX-1.2.0-windows-x64/", b""), ("PESHeX-1.2.0-windows-x64/PESHeX.exe", b"exe"), ("PESHeX-1.2.0-windows-x64/ruby/a.rb", b"rb")]);
    let dest = dir.path().join("out");
    let files = apply::extract(&zip, &dest, &Limits::default()).unwrap();
    assert_eq!(files, vec!["PESHeX.exe", "ruby/a.rb"]);
    assert_eq!(read(&dest, "ruby/a.rb"), "rb");
}

#[test]
fn sin_carpeta_raiz_conserva_las_rutas() {
    let dir = tempfile::tempdir().unwrap();
    let zip = dir.path().join("p.zip");
    make_zip(&zip, &[("PESHeX.exe", b"exe"), ("ruby/a.rb", b"rb")]);
    let files = apply::extract(&zip, &dir.path().join("out"), &Limits::default()).unwrap();
    assert_eq!(files, vec!["PESHeX.exe", "ruby/a.rb"]);
}

#[test]
fn zip_slip_no_escribe_fuera() {
    for evil in ["../evil.txt", "PESHeX/../../evil.txt", "/evil.txt", "..\\evil.txt", "C:/evil.txt"] {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("p.zip");
        make_zip(&zip, &[("PESHeX/ok.txt", b"ok"), (evil, b"mal")]);
        let dest = dir.path().join("sub").join("out");
        let r = apply::extract(&zip, &dest, &Limits::default());
        assert!(matches!(r, Err(UpdateError::BadArchive(_))), "{evil}: {r:?}");
        assert!(!dir.path().join("evil.txt").exists() && !dir.path().join("sub").join("evil.txt").exists(), "{evil}");
        assert!(!dest.exists() || fs::read_dir(&dest).unwrap().next().is_none(), "no se extrajo nada de un zip con rutas peligrosas");
    }
}

#[test]
fn los_enlaces_simbolicos_se_rechazan() {
    use zip::write::SimpleFileOptions;
    let dir = tempfile::tempdir().unwrap();
    let zip = dir.path().join("p.zip");
    let mut w = zip::ZipWriter::new(fs::File::create(&zip).unwrap());
    w.add_symlink("PESHeX/link", "/etc/passwd", SimpleFileOptions::default()).unwrap();
    w.finish().unwrap();
    let r = apply::extract(&zip, &dir.path().join("out"), &Limits::default());
    assert!(matches!(r, Err(UpdateError::BadArchive(_))), "{r:?}");
}

#[test]
fn los_limites_frenan_una_bomba() {
    let dir = tempfile::tempdir().unwrap();
    let zip = dir.path().join("p.zip");
    make_zip(&zip, &[("a/1", &[0u8; 5000]), ("a/2", &[0u8; 5000])]);
    let r = apply::extract(&zip, &dir.path().join("o1"), &Limits { max_entries: 50, max_total: 9000 });
    assert!(matches!(r, Err(UpdateError::BadArchive(_))), "{r:?}");
    let r = apply::extract(&zip, &dir.path().join("o2"), &Limits { max_entries: 1, max_total: 1 << 30 });
    assert!(matches!(r, Err(UpdateError::BadArchive(_))), "{r:?}");
    assert!(apply::extract(&zip, &dir.path().join("o3"), &Limits::default()).is_ok());
}

#[test]
fn un_zip_corrupto_se_rechaza() {
    let dir = tempfile::tempdir().unwrap();
    let zip = dir.path().join("p.zip");
    fs::write(&zip, b"esto no es un zip").unwrap();
    assert!(matches!(apply::extract(&zip, &dir.path().join("out"), &Limits::default()), Err(UpdateError::BadArchive(_))));
    // Truncado a la mitad
    let good = dir.path().join("g.zip");
    make_zip(&good, &[("a/x", &support::blob(20_000))]);
    let bytes = fs::read(&good).unwrap();
    fs::write(&zip, &bytes[..bytes.len() / 2]).unwrap();
    assert!(apply::extract(&zip, &dir.path().join("out2"), &Limits::default()).is_err());
}

#[test]
fn valida_el_contenido_contra_el_manifiesto() {
    let dir = tempfile::tempdir().unwrap();
    let stage = dir.path().join("stage");
    package(&stage, &[("PESHeX.exe", "exe"), ("ruby/a.rb", "rb")]);
    let files = apply::validate(&stage, "PESHeX.exe").unwrap();
    assert_eq!(files, vec!["CONTENIDO.sha256", "PESHeX.exe", "ruby/a.rb"]);

    // Un archivo alterado
    fs::write(stage.join("ruby/a.rb"), "alterado").unwrap();
    assert!(matches!(apply::validate(&stage, "PESHeX.exe"), Err(UpdateError::BadArchive(_))));
    // Un archivo que falta
    package(&stage, &[("PESHeX.exe", "exe"), ("ruby/a.rb", "rb")]);
    fs::remove_file(stage.join("ruby/a.rb")).unwrap();
    assert!(matches!(apply::validate(&stage, "PESHeX.exe"), Err(UpdateError::BadArchive(_))));
    // Uno que sobra
    package(&stage, &[("PESHeX.exe", "exe"), ("ruby/a.rb", "rb")]);
    put(&stage, "extra.dll", b"intruso");
    assert!(matches!(apply::validate(&stage, "PESHeX.exe"), Err(UpdateError::BadArchive(_))));
    // Sin manifiesto o sin el ejecutable
    let s2 = dir.path().join("s2");
    put(&s2, "PESHeX.exe", b"exe");
    assert!(apply::validate(&s2, "PESHeX.exe").is_err());
    let s3 = dir.path().join("s3");
    package(&s3, &[("ruby/a.rb", "rb")]);
    assert!(apply::validate(&s3, "PESHeX.exe").is_err());
}

fn install_old(app: &Path) {
    package(app, &[("PESHeX.exe", "exe VIEJO"), ("ruby/a.rb", "a viejo"), ("ruby/gone.rb", "se elimina"), ("old/dir/only.txt", "x")]);
    put(app, "datos-del-usuario.txt", b"no tocar");
}

#[test]
fn reemplaza_retira_lo_viejo_y_respeta_lo_ajeno() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("app");
    let stage = dir.path().join("stage");
    install_old(&app);
    package(&stage, &[("PESHeX.exe", "exe NUEVO"), ("ruby/a.rb", "a nuevo"), ("ruby/new.rb", "nuevo"), ("PESHeX-Updater.exe", "upd")]);

    let old = apply::installed_files(&app);
    assert!(old.contains(&"ruby/gone.rb".to_string()) && old.contains(&"CONTENIDO.sha256".to_string()));
    let new_files = apply::validate(&stage, "PESHeX.exe").unwrap();
    let sw = apply::swap(&app, &stage, &new_files, &old, "PESHeX.exe", "t1", &fast()).unwrap();

    assert_eq!(read(&app, "PESHeX.exe"), "exe NUEVO");
    assert_eq!(read(&app, "ruby/a.rb"), "a nuevo");
    assert_eq!(read(&app, "ruby/new.rb"), "nuevo");
    assert_eq!(read(&app, "PESHeX-Updater.exe"), "upd");
    assert!(!app.join("ruby/gone.rb").exists(), "lo que la version nueva ya no trae se retira");
    assert!(!app.join("old").exists(), "y las carpetas que quedan vacias tambien");
    assert_eq!(read(&app, "datos-del-usuario.txt"), "no tocar", "lo que no es del paquete no se toca");
    assert!(apply::installed_files(&app).contains(&"ruby/new.rb".to_string()), "el manifiesto instalado es el nuevo");
    let backup = sw.backup_dir().to_path_buf();
    assert_eq!(read(&backup, "PESHeX.exe"), "exe VIEJO", "hasta confirmar queda la copia de lo antiguo");
    sw.commit();
    assert!(!backup.exists());
}

#[test]
fn si_algo_falla_se_deshace_todo() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("app");
    let stage = dir.path().join("stage");
    install_old(&app);
    // `zzz` es un ARCHIVO en la app pero el paquete lo quiere como carpeta: el reemplazo falla a mitad de camino.
    put(&app, "zzz", b"soy un archivo");
    package(&stage, &[("PESHeX.exe", "exe NUEVO"), ("ruby/a.rb", "a nuevo"), ("ruby/new.rb", "nuevo"), ("zzz/x.txt", "choca")]);

    let before = apply::list_files(&app).unwrap();
    let old = apply::installed_files(&app);
    let new_files = apply::validate(&stage, "PESHeX.exe").unwrap();
    let r = apply::swap(&app, &stage, &new_files, &old, "PESHeX.exe", "t2", &fast());
    assert!(r.is_err(), "{r:?}");

    assert_eq!(apply::list_files(&app).unwrap(), before, "la carpeta queda exactamente como estaba (sin archivos nuevos ni copias)");
    assert_eq!(read(&app, "PESHeX.exe"), "exe VIEJO");
    assert_eq!(read(&app, "ruby/a.rb"), "a viejo");
    assert_eq!(read(&app, "ruby/gone.rb"), "se elimina");
    assert_eq!(read(&app, "zzz"), "soy un archivo");
    assert!(!app.join(format!("{}t2", apply::BACKUP_PREFIX)).exists());
}

#[test]
fn rollback_manual_tras_un_exito_parcial() {
    // Caso del relanzamiento fallido: el reemplazo salio bien pero PESHeX no arranca -> se vuelve a la version anterior.
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("app");
    let stage = dir.path().join("stage");
    install_old(&app);
    package(&stage, &[("PESHeX.exe", "exe NUEVO"), ("ruby/a.rb", "a nuevo")]);
    let old = apply::installed_files(&app);
    let new_files = apply::validate(&stage, "PESHeX.exe").unwrap();
    let before = apply::list_files(&app).unwrap();
    let mut sw = apply::swap(&app, &stage, &new_files, &old, "PESHeX.exe", "t3", &fast()).unwrap();
    assert_eq!(read(&app, "PESHeX.exe"), "exe NUEVO");
    sw.rollback().unwrap();
    assert_eq!(apply::list_files(&app).unwrap(), before);
    assert_eq!(read(&app, "ruby/gone.rb"), "se elimina");
    assert_eq!(read(&app, "PESHeX.exe"), "exe VIEJO");
}

#[test]
fn comprueba_que_la_carpeta_se_puede_escribir() {
    let dir = tempfile::tempdir().unwrap();
    assert!(apply::check_writable(dir.path()).is_ok());
    assert!(!dir.path().join(".peshex-write-test").exists());
    assert!(matches!(apply::check_writable(&dir.path().join("no-existe")), Err(UpdateError::NotWritable(_))));
}

#[test]
fn espera_a_que_el_ejecutable_se_pueda_escribir() {
    let dir = tempfile::tempdir().unwrap();
    // Sin ejecutable (primera instalacion) no hay nada que esperar.
    assert!(apply::wait_until_writable(&dir.path().join("PESHeX.exe"), Duration::from_millis(50), Duration::from_millis(5)).is_ok());
    put(dir.path(), "PESHeX.exe", b"x");
    assert!(apply::wait_until_writable(&dir.path().join("PESHeX.exe"), Duration::from_millis(50), Duration::from_millis(5)).is_ok());
}

#[test]
fn limpia_restos_de_actualizaciones_interrumpidas() {
    let dir = tempfile::tempdir().unwrap();
    put(dir.path(), ".peshex-update/stage/x", b"1");
    put(dir.path(), ".update-backup-123/PESHeX.exe", b"2");
    put(dir.path(), "PESHeX.exe", b"3");
    apply::cleanup_leftovers(dir.path());
    assert!(!dir.path().join(".peshex-update").exists() && !dir.path().join(".update-backup-123").exists());
    assert!(dir.path().join("PESHeX.exe").exists());
}

/// Un ejecutable en ejecucion no se puede abrir para escribir (Windows: violacion de uso compartido; Linux: «Text file busy»),
/// y el reemplazo debe esperar a que se cierre. Se prueba con un proceso real llamado PESHeX.exe: una copia del propio actualizador (un .exe sin
/// dependencias de otros archivos) en modo `run`, que se queda esperando ordenes por stdin mientras no se cierre su tuberia.
#[test]
fn reemplaza_un_exe_en_ejecucion_cuando_se_cierra() {
    use std::process::{Command, Stdio};
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("app");
    let stage = dir.path().join("stage");
    fs::create_dir_all(&app).unwrap();
    fs::copy(env!("CARGO_BIN_EXE_PESHeX-Updater"), app.join("PESHeX.exe")).unwrap();
    // CONTENIDO.sha256 de la version instalada
    fs::write(app.join("CONTENIDO.sha256"), format!("{} *PESHeX.exe\n", sha256_bytes(&fs::read(app.join("PESHeX.exe")).unwrap()))).unwrap();
    package(&stage, &[("PESHeX.exe", "exe NUEVO"), ("ruby/a.rb", "a nuevo")]);

    // «La app» en ejecucion (la tuberia de stdin abierta la mantiene viva).
    let mut running = Command::new(app.join("PESHeX.exe")).arg("run").stdin(Stdio::piped()).stdout(Stdio::null()).spawn().unwrap();
    std::thread::sleep(Duration::from_millis(300)); // que arranque de verdad
    assert!(running.try_wait().unwrap().is_none(), "el proceso de prueba debe seguir vivo");
    // Mientras corre no se puede abrir para escribir: la espera agota su tiempo y dice por que.
    let blocked = apply::wait_until_writable(&app.join("PESHeX.exe"), Duration::from_millis(400), Duration::from_millis(50));
    assert!(matches!(blocked, Err(UpdateError::NotWritable(_))), "{blocked:?}");

    // Se cierra «un segundo despues»: el reemplazo la espera y termina bien.
    let killer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(700));
        running.kill().unwrap();
        running.wait().unwrap();
    });
    apply::wait_until_writable(&app.join("PESHeX.exe"), Duration::from_secs(20), Duration::from_millis(50)).unwrap();
    let old = apply::installed_files(&app);
    let new_files = apply::validate(&stage, "PESHeX.exe").unwrap();
    let sw = apply::swap(&app, &stage, &new_files, &old, "PESHeX.exe", "win", &SwapOptions::default()).unwrap();
    killer.join().unwrap();
    assert_eq!(read(&app, "PESHeX.exe"), "exe NUEVO");
    assert_eq!(read(&app, "ruby/a.rb"), "a nuevo");
    sw.commit();
    assert!(!app.join(".update-backup-win").exists());
}
