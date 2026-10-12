//! Tests de integracion contra el driver real (requieren `ruby` en el PATH).
//!
//! A diferencia de un test unitario tipico, esto lanza el proceso Ruby de
//! verdad y le habla el protocolo JSON real, contra una copia de un save de
//! prueba real: es la forma mas fiel de probar la capa Rust<->Ruby sin
//! necesitar `tauri dev` con una ventana (no disponible en CI Linux).

use rxdriver::{DriverCallError, DriverSession};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    // src-tauri/crates/rxdriver -> raiz del repo
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
}

fn driver_script_path() -> PathBuf {
    repo_root().join("driver").join("rxdata_driver.rb")
}

async fn spawn_test_session() -> DriverSession {
    DriverSession::spawn(Path::new("ruby"), &driver_script_path())
        .await
        .expect("no se pudo lanzar 'ruby' - necesita estar en el PATH para este test")
}

/// Copia un fixture de test_saves/ a un archivo temporal unico, para no
/// mutar nunca los archivos versionados en el repo.
fn copy_fixture(name: &str) -> PathBuf {
    let src = repo_root().join("test_saves").join(name);
    let dest = std::env::temp_dir().join(format!("peshex_test_{}_{name}", std::process::id()));
    std::fs::copy(&src, &dest).expect("no se pudo copiar el fixture de prueba");
    dest
}

fn cleanup_fixture(fixture: &Path) {
    let _ = std::fs::remove_file(fixture);
    let Some(dir) = fixture.parent() else { return };
    let Some(stem) = fixture
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
    else {
        return;
    };
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&stem) && name.ends_with(".bak") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

#[tokio::test]
async fn abre_edita_guarda_y_reabre_un_save_real() {
    let fixture = copy_fixture("Partida_2.rxdata");
    let fixture_str = fixture.to_str().expect("path UTF-8").to_string();

    let mut session = spawn_test_session().await;
    let opened = session
        .call(
            "open",
            json!({ "path": fixture_str, "autodetect": false, "pageSize": 50 }),
        )
        .await
        .expect("open deberia funcionar contra un save real");
    assert_eq!(opened["roundtripChecked"], json!(false));
    let verified = session
        .call("verify_roundtrip", json!({}))
        .await
        .expect("verify_roundtrip deberia funcionar");
    assert_eq!(verified["roundtripClean"], json!(true));
    assert_eq!(
        opened["indexState"],
        json!("idle"),
        "abrir no debe construir el indice de campos"
    );

    let page = session
        .call("list_fields", json!({ "filterPath": "", "page": 0 }))
        .await
        .expect("list_fields deberia funcionar");
    let fields = page["fields"].as_array().expect("fields es un array");
    assert!(!fields.is_empty());
    let target = fields
        .iter()
        .find(|f| f["type"] == json!("int"))
        .expect("el save de prueba deberia tener al menos un campo int");
    let target_index = target["index"].as_u64().expect("index numerico");

    let set = session
        .call(
            "set_field",
            json!({ "index": target_index, "input": "int:777", "confirmed": false }),
        )
        .await
        .expect("set_field deberia aplicar un literal int valido sin pedir confirmacion");
    assert_eq!(set["applied"], json!(true), "{set}");

    let saved = session
        .call("save", json!({ "backup": true, "confirmed": false }))
        .await
        .expect("save deberia funcionar");
    assert_eq!(saved["applied"], json!(true));
    assert!(saved["bytesWritten"].as_u64().unwrap_or(0) > 0);
    assert!(saved["backupPath"].is_string(), "deberia haberse creado un .bak");

    session.shutdown().await;

    // Reabrir en un proceso Ruby nuevo y confirmar que el cambio quedo
    // en el archivo de verdad (no solo en la memoria de la 1ra sesion).
    let mut session2 = spawn_test_session().await;
    session2
        .call("open", json!({ "path": fixture_str, "autodetect": false }))
        .await
        .expect("reabrir el archivo guardado deberia funcionar");
    let refetched = session2
        .call("get_field", json!({ "index": target_index }))
        .await
        .expect("get_field deberia funcionar tras reabrir");
    assert_eq!(refetched["value"]["display"], json!("777"));
    session2.shutdown().await;

    cleanup_fixture(&fixture);
}

#[tokio::test]
async fn los_errores_logicos_conservan_tipo_y_la_sesion_sigue_sana() {
    let mut session = spawn_test_session().await;

    let err = session
        .call("list_fields", json!({}))
        .await
        .expect_err("sin archivo abierto debe fallar");
    match &err {
        DriverCallError::Logical { kind, .. } => assert_eq!(kind, "NoSessionOpen"),
        other => panic!("se esperaba un error logico, llego {other:?}"),
    }
    assert!(!err.is_fatal());

    let pong: Value = session.call("ping", json!({})).await.expect("ping");
    assert_eq!(pong["pong"], json!(true));
    session.shutdown().await;
}
