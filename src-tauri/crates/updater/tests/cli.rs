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
