//! El ejecutable `PESHeX-Updater` tal como lo lanza la app (sin red).

use std::io::Write;
use std::process::{Command, Stdio};

const EXE: &str = env!("CARGO_BIN_EXE_PESHeX-Updater");

#[test]
fn version() {
    let out = Command::new(EXE).arg("--version").output().unwrap();
    assert!(out.status.success());
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), format!("PESHeX-Updater {}", env!("CARGO_PKG_VERSION")));
}

#[test]
fn check_con_una_version_invalida_informa_el_error_en_json_sin_salir_con_fallo() {
    let out = Command::new(EXE).args(["check", "--current", "no-es-version"]).output().unwrap();
    assert!(out.status.success(), "siempre sale con 0 e imprime un JSON");
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(v["status"], "error");
    assert_eq!(v["code"], "invalid");
}

#[test]
fn argumentos_desconocidos_salen_con_2() {
    assert_eq!(Command::new(EXE).output().unwrap().status.code(), Some(2));
    assert_eq!(Command::new(EXE).arg("hazlo").output().unwrap().status.code(), Some(2));
}

#[test]
fn run_sin_ordenes_termina_al_cerrarse_stdin() {
    let mut child = Command::new(EXE).arg("run").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    drop(child.stdin.take());
    assert_eq!(child.wait().unwrap().code(), Some(0));
}

#[test]
fn run_con_una_orden_incorrecta_la_ignora_y_con_un_inicio_con_url_ajena_informa_el_error() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("app");
    std::fs::create_dir_all(&app).unwrap();
    let mut child = Command::new(EXE).arg("run").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    {
        let mut stdin = child.stdin.take().unwrap();
        writeln!(stdin, "esto no es json").unwrap();
        let release = serde_json::json!({
            "tag": "v9.9.9", "version": "9.9.9", "name": "x", "notes": "", "url": "", "publishedAt": null, "prerelease": false,
            "asset": { "name": "PESHeX-9.9.9-windows-x64.zip", "url": "http://127.0.0.1:9/a.zip", "size": 10 },
            "sumsUrl": "http://127.0.0.1:9/SHA256SUMS.txt"
        });
        writeln!(stdin, "{}", serde_json::json!({ "cmd": "start", "release": release, "appDir": app, "workDir": dir.path().join("w") })).unwrap();
    }
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    let text = String::from_utf8_lossy(&out.stdout);
    let last: serde_json::Value = serde_json::from_str(text.lines().last().unwrap()).unwrap();
    assert_eq!(last["event"], "error");
    assert_eq!(last["code"], "host_not_allowed", "en produccion solo se habla con GitHub por https: {text}");
}

// ── apply-local: instala un zip ya descargado (sin red) con el mismo codigo que la actualizacion normal ──

mod support;
use peshex_updater::sums::sha256_bytes;
use std::fs;
use std::path::Path;

fn write(root: &Path, rel: &str, data: &[u8]) {
    let p = root.join(rel);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, data).unwrap();
}

/// Zip de una version «nueva» con carpeta raiz y CONTENIDO.sha256 correcto.
fn new_package(zip: &Path, files: &[(&str, &[u8])]) {
    let mut manifest = String::new();
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    for (n, d) in files {
        manifest.push_str(&format!("{} *{}\n", sha256_bytes(d), n));
        entries.push((format!("PESHeX-9.9.9-windows-x64/{n}"), d.to_vec()));
    }
    entries.push(("PESHeX-9.9.9-windows-x64/CONTENIDO.sha256".into(), manifest.into_bytes()));
    let borrowed: Vec<(&str, &[u8])> = entries.iter().map(|(n, d)| (n.as_str(), d.as_slice())).collect();
    support::make_zip(zip, &borrowed);
}

#[test]
fn apply_local_instala_un_zip_y_deja_la_carpeta_limpia() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("Mi carpeta ñandú").join("PESHeX");
    write(&app, "PESHeX.exe", b"exe viejo");
    write(&app, "viejo.txt", b"solo en la version vieja");
    write(&app, "ruby/lib/a.rb", b"a viejo");
    write(&app, "usuario.txt", b"mio");
    write(&app, "CONTENIDO.sha256", format!("{} *PESHeX.exe\n{} *viejo.txt\n{} *ruby/lib/a.rb\n", sha256_bytes(b"exe viejo"), sha256_bytes(b"solo en la version vieja"), sha256_bytes(b"a viejo")).as_bytes());
    let zip = dir.path().join("nuevo.zip");
    new_package(&zip, &[("PESHeX.exe", b"exe NUEVO"), ("ruby/lib/a.rb", b"a nuevo"), ("ruby/lib/b.rb", b"b nuevo")]);
    let log = dir.path().join("logs").join("updater.log");

    let out = Command::new(EXE)
        .args(["apply-local", "--zip"]).arg(&zip).arg("--app-dir").arg(&app).args(["--no-relaunch", "--wait", "5", "--log"]).arg(&log)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(String::from_utf8_lossy(&out.stdout).contains("ok: 4 archivos")); // 3 + CONTENIDO.sha256

    assert_eq!(fs::read(app.join("PESHeX.exe")).unwrap(), b"exe NUEVO");
    assert_eq!(fs::read(app.join("ruby/lib/b.rb")).unwrap(), b"b nuevo");
    assert!(!app.join("viejo.txt").exists(), "lo que la version nueva ya no trae se retira");
    assert_eq!(fs::read(app.join("usuario.txt")).unwrap(), b"mio", "lo ajeno no se toca");
    let leftovers: Vec<_> = fs::read_dir(&app).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with('.')).collect();
    assert!(leftovers.is_empty(), "sin carpeta de preparacion ni copias: {leftovers:?}");
    // El registro cuenta lo que paso
    let text = fs::read_to_string(&log).unwrap();
    assert!(text.contains("paquete local preparado y validado: 4 archivos"), "{text}");
    assert!(text.contains("instalacion completada"), "{text}");
}

#[test]
fn apply_local_rechaza_un_paquete_alterado_y_no_toca_nada() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("app");
    write(&app, "PESHeX.exe", b"exe viejo");
    let zip = dir.path().join("malo.zip");
    // El manifiesto no coincide con el contenido
    support::make_zip(&zip, &[("PESHeX/PESHeX.exe", b"otro contenido"), ("PESHeX/CONTENIDO.sha256", format!("{} *PESHeX.exe\n", "0".repeat(64)).as_bytes())]);
    let out = Command::new(EXE).args(["apply-local", "--zip"]).arg(&zip).arg("--app-dir").arg(&app).arg("--no-relaunch").output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("bad_archive"));
    assert_eq!(fs::read(app.join("PESHeX.exe")).unwrap(), b"exe viejo");
    assert!(!app.join(".peshex-update").exists());
}

#[test]
fn apply_local_sin_argumentos_sale_con_2() {
    assert_eq!(Command::new(EXE).arg("apply-local").output().unwrap().status.code(), Some(2));
}

#[test]
fn check_con_log_anota_el_resultado_aunque_falle() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("updates").join("updater.log");
    let out = Command::new(EXE).args(["check", "--current", "no-es-version", "--log"]).arg(&log).output().unwrap();
    assert!(out.status.success());
    let text = fs::read_to_string(&log).unwrap();
    assert!(text.contains("ERROR") && text.contains("[updater] check --current no-es-version: invalid"), "{text}");
}
