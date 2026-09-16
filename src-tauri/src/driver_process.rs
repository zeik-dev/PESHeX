//! Ciclo de vida y protocolo del proceso hijo `rxdata_driver.rb`.
//!
//! Protocolo: una linea JSON de peticion -> exactamente una linea JSON de
//! respuesta, en orden, nunca dos comandos en vuelo a la vez (lo garantiza
//! el Mutex que envuelve la sesion en `AppState`). El campo `id` es solo un
//! chequeo defensivo de desincronizacion del stream de lineas.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};

/// Distingue un error de dominio que el driver reporto con `ok:false`
/// (la sesion Ruby sigue sana, ej. un literal invalido) de una falla de
/// E/S o de protocolo (el proceso murio o el stream se desincronizo: la
/// sesion debe darse de baja, no se puede seguir usando).
#[derive(Debug)]
pub enum DriverCallError {
    Logical(String),
    Fatal(String),
}

impl DriverCallError {
    pub fn message(&self) -> String {
        match self {
            DriverCallError::Logical(m) | DriverCallError::Fatal(m) => m.clone(),
        }
    }

    pub fn is_fatal(&self) -> bool {
        matches!(self, DriverCallError::Fatal(_))
    }
}

pub struct DriverSession {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    next_id: u64,
}

impl DriverSession {
    pub async fn spawn(ruby_bin: &Path, driver_script: &Path) -> std::io::Result<Self> {
        let mut cmd = tokio::process::Command::new(ruby_bin);
        cmd.arg("-E")
            .arg("UTF-8")
            .arg(driver_script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_remove("RUBYOPT")
            .env_remove("GEM_HOME")
            .env_remove("GEM_PATH")
            .env_remove("RUBYLIB");

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn()?;
        let stdin = child
            .stdin
            .take()
            .expect("stdin fue pedido con Stdio::piped()");
        let stdout = child
            .stdout
            .take()
            .expect("stdout fue pedido con Stdio::piped()");
        let stderr = child
            .stderr
            .take()
            .expect("stderr fue pedido con Stdio::piped()");

        // edit_rxdata.rb y el driver nunca escriben protocolo en stderr, solo
        // backtraces de depuracion (ver RXDATA_DRIVER_DEBUG) - es seguro
        // limitarse a loguearlo sin que contamine nunca el stream de stdout.
        tokio::spawn(async move {
            let mut err_lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = err_lines.next_line().await {
                eprintln!("[rxdata_driver] {line}");
            }
        });

        Ok(Self {
            child,
            stdin,
            lines: BufReader::new(stdout).lines(),
            next_id: 1,
        })
    }

    async fn call(&mut self, cmd: &str, params: Value) -> Result<Value, DriverCallError> {
        let id = self.next_id;
        self.next_id += 1;

        let mut request = match params {
            Value::Object(map) => map,
            _ => serde_json::Map::new(),
        };
        request.insert("id".into(), json!(id));
        request.insert("cmd".into(), json!(cmd));

        let mut line = serde_json::to_string(&Value::Object(request)).map_err(|e| {
            DriverCallError::Fatal(format!("no se pudo serializar la peticion: {e}"))
        })?;
        line.push('\n');

        self.stdin.write_all(line.as_bytes()).await.map_err(|e| {
            DriverCallError::Fatal(format!("no se pudo escribir al proceso Ruby: {e}"))
        })?;
        self.stdin.flush().await.map_err(|e| {
            DriverCallError::Fatal(format!("no se pudo escribir al proceso Ruby: {e}"))
        })?;

        let response_line = self
            .lines
            .next_line()
            .await
            .map_err(|e| DriverCallError::Fatal(format!("no se pudo leer del proceso Ruby: {e}")))?
            .ok_or_else(|| {
                DriverCallError::Fatal("el proceso del editor se cerro inesperadamente".to_string())
            })?;

        let response: Value = serde_json::from_str(response_line.trim()).map_err(|e| {
            DriverCallError::Fatal(format!(
                "respuesta invalida del proceso Ruby: {e} ({response_line})"
            ))
        })?;

        let resp_id = response.get("id").and_then(Value::as_u64);
        if resp_id != Some(id) {
            return Err(DriverCallError::Fatal(format!(
                "el proceso Ruby se desincronizo (esperaba id {id}, recibio {resp_id:?})"
            )));
        }

        if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            Ok(response)
        } else {
            let message = response
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("error desconocido del driver")
                .to_string();
            Err(DriverCallError::Logical(message))
        }
    }

    fn parse<T: for<'de> Deserialize<'de>>(response: Value) -> Result<T, DriverCallError> {
        serde_json::from_value(response)
            .map_err(|e| DriverCallError::Fatal(format!("respuesta inesperada del driver: {e}")))
    }

    pub async fn check(&mut self, path: &str) -> Result<CheckResult, DriverCallError> {
        let resp = self.call("check", json!({ "path": path })).await?;
        Self::parse(resp)
    }

    pub async fn open(
        &mut self,
        path: &str,
        scripts: &[String],
        autodetect: bool,
        page_size: u32,
    ) -> Result<OpenResult, DriverCallError> {
        let resp = self
            .call(
                "open",
                json!({ "path": path, "scripts": scripts, "autodetect": autodetect, "pageSize": page_size }),
            )
            .await?;
        Self::parse(resp)
    }

    pub async fn list_fields(
        &mut self,
        filter_path: &str,
        filter_type: Option<&str>,
        page: u32,
    ) -> Result<ListFieldsResult, DriverCallError> {
        let resp = self
            .call(
                "list_fields",
                json!({ "filterPath": filter_path, "filterType": filter_type, "page": page }),
            )
            .await?;
        Self::parse(resp)
    }

    pub async fn get_field(&mut self, index: u64) -> Result<GetFieldResult, DriverCallError> {
        let resp = self.call("get_field", json!({ "index": index })).await?;
        Self::parse(resp)
    }

    pub async fn list_templates(
        &mut self,
        class_name: &str,
    ) -> Result<ListTemplatesResult, DriverCallError> {
        let resp = self
            .call("list_templates", json!({ "className": class_name }))
            .await?;
        Self::parse(resp)
    }

    pub async fn set_field(
        &mut self,
        index: u64,
        input: &str,
        confirmed: bool,
    ) -> Result<SetFieldResult, DriverCallError> {
        let resp = self
            .call(
                "set_field",
                json!({ "index": index, "input": input, "confirmed": confirmed }),
            )
            .await?;
        Self::parse(resp)
    }

    pub async fn list_changes(&mut self) -> Result<ListChangesResult, DriverCallError> {
        let resp = self.call("list_changes", json!({})).await?;
        Self::parse(resp)
    }

    pub async fn nil_report(&mut self) -> Result<NilReportResult, DriverCallError> {
        let resp = self.call("nil_report", json!({})).await?;
        Self::parse(resp)
    }

    pub async fn save(
        &mut self,
        backup: bool,
        confirmed: bool,
    ) -> Result<SaveResult, DriverCallError> {
        let resp = self
            .call("save", json!({ "backup": backup, "confirmed": confirmed }))
            .await?;
        Self::parse(resp)
    }

    /// Cierre prolijo: pide `shutdown`, espera un poco a que el proceso
    /// salga solo, y si no lo mata. Se usa tanto al cerrar/reemplazar un
    /// archivo abierto como al salir de la app.
    pub async fn shutdown(&mut self) {
        let _ = self.call("shutdown", json!({})).await;
        let waited =
            tokio::time::timeout(std::time::Duration::from_secs(2), self.child.wait()).await;
        if waited.is_err() {
            let _ = self.child.start_kill();
        }
    }

    /// Kill sincrono de mejor esfuerzo, para el hook de salida de la app
    /// (donde no es practico esperar a un `.await`).
    pub fn kill_blocking(&mut self) {
        let _ = self.child.start_kill();
    }
}

// ── Tipos de respuesta (espejo exacto del protocolo JSON de rxdata_driver.rb) ─

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub roots: u64,
    pub wrapper: String,
    pub roundtrip_clean: bool,
    pub diff_byte: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptReport {
    pub files_scanned: u64,
    pub hints: u64,
    pub fallback_files: u64,
    pub roots_used: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    pub roots: u64,
    pub wrapper: String,
    pub roundtrip_clean: bool,
    pub diff_byte: Option<u64>,
    pub field_count: u64,
    pub nil_count: u64,
    pub scripts: ScriptReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValueSummary {
    pub kind: String,
    pub display: String,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub truncated: Option<bool>,
    #[serde(default, rename = "fullLength")]
    pub full_length: Option<u64>,
    #[serde(default)]
    pub count: Option<u64>,
    #[serde(default)]
    pub special: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferredSummary {
    #[serde(rename = "type")]
    pub value_type: String,
    pub confidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldRow {
    pub index: u64,
    pub path: String,
    #[serde(rename = "type")]
    pub value_type: String,
    #[serde(rename = "nil")]
    pub is_nil: bool,
    #[serde(default)]
    pub value: Option<ValueSummary>,
    #[serde(default)]
    pub inferred: Option<InferredSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFieldsResult {
    pub total: u64,
    pub total_pages: u64,
    pub page: u64,
    pub page_size: u64,
    pub pending_count: u64,
    pub fields: Vec<FieldRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    #[serde(rename = "type")]
    pub value_type: String,
    pub score_pct: i64,
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NilInference {
    pub confidence: Option<String>,
    pub candidates: Vec<Candidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateInfo {
    #[serde(rename = "class")]
    pub class_name: String,
    pub count: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetFieldResult {
    pub index: u64,
    pub path: String,
    pub slot_keys: Vec<String>,
    #[serde(rename = "type")]
    pub value_type: String,
    #[serde(rename = "nil")]
    pub is_nil: bool,
    #[serde(default)]
    pub value: Option<ValueSummary>,
    #[serde(default)]
    pub nil_inference: Option<NilInference>,
    pub templates: Vec<TemplateInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateInstance {
    pub slot: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListTemplatesResult {
    #[serde(rename = "class")]
    pub class_name: String,
    pub instances: Vec<TemplateInstance>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SetFieldResult {
    pub applied: bool,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub needs_confirmation: Option<bool>,
    #[serde(default)]
    pub needs_template_choice: Option<bool>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub inferred_type: Option<String>,
    #[serde(default)]
    pub proposed_type: Option<String>,
    #[serde(default)]
    pub current_type: Option<String>,
    #[serde(default, rename = "class")]
    pub class_name: Option<String>,
    #[serde(default)]
    pub instances: Option<Vec<TemplateInstance>>,
    #[serde(default)]
    pub old: Option<ValueSummary>,
    #[serde(default)]
    pub new: Option<ValueSummary>,
    #[serde(default)]
    pub pending_count: Option<u64>,
    #[serde(default)]
    pub structural_rebuild: Option<bool>,
    #[serde(default)]
    pub new_field_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeEntry {
    pub path: String,
    pub old: ValueSummary,
    pub new: ValueSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListChangesResult {
    pub count: u64,
    pub changes: Vec<ChangeEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NilReportGroup {
    pub slot_key: String,
    pub count: u64,
    pub inferred_type: Option<String>,
    pub confidence: Option<String>,
    pub top_evidence: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NilReportSummary {
    pub alta: u64,
    pub media: u64,
    pub baja: u64,
    pub sin: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NilReportResult {
    pub groups: Vec<NilReportGroup>,
    pub summary: NilReportSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub applied: bool,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub needs_confirmation: Option<bool>,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub bytes_written: Option<u64>,
    #[serde(default)]
    pub backup_path: Option<String>,
    #[serde(default)]
    pub changes_applied: Option<u64>,
}

// ── Tests de integracion contra el driver real (requieren `ruby` en el PATH) ─
//
// A diferencia de un test unitario tipico, esto lanza el proceso Ruby de
// verdad y le habla el protocolo JSON real, contra una copia de un save de
// prueba real - es la forma mas fiel de probar la capa Rust<->Ruby sin
// necesitar `tauri dev` con una ventana real (no disponible en CI/WSL2).
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn repo_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri debe estar dentro del repo")
            .to_path_buf()
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
        let dest =
            std::env::temp_dir().join(format!("pbs_editor_test_{}_{name}", std::process::id()));
        std::fs::copy(&src, &dest).expect("no se pudo copiar el fixture de prueba");
        dest
    }

    fn cleanup_fixture(fixture: &Path) {
        let _ = std::fs::remove_file(fixture);
        let Some(dir) = fixture.parent() else { return };
        let Some(stem) = fixture.file_name().map(|n| n.to_string_lossy().to_string()) else {
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
            .open(&fixture_str, &[], true, 50)
            .await
            .expect("open deberia funcionar contra un save real");
        assert!(opened.field_count > 0);
        assert!(
            opened.roundtrip_clean,
            "el fixture deberia reconstruirse identico byte a byte"
        );

        let page = session
            .list_fields("", None, 0)
            .await
            .expect("list_fields deberia funcionar");
        assert!(!page.fields.is_empty());
        let target = page
            .fields
            .iter()
            .find(|f| f.value_type == "int")
            .expect("el save de prueba deberia tener al menos un campo int");

        let set = session
            .set_field(target.index, "int:777", false)
            .await
            .expect("set_field deberia aplicar un literal int valido sin pedir confirmacion");
        assert!(set.applied, "la edicion deberia aplicarse: {set:?}");

        let saved = session
            .save(true, false)
            .await
            .expect("save deberia funcionar");
        assert!(saved.applied);
        assert!(saved.bytes_written.unwrap_or(0) > 0);
        assert!(
            saved.backup_path.is_some(),
            "deberia haberse creado un .bak"
        );

        session.shutdown().await;

        // Reabrir en un proceso Ruby nuevo y confirmar que el cambio quedo
        // en el archivo de verdad (no solo en la memoria de la 1ra sesion).
        let mut session2 = spawn_test_session().await;
        session2
            .open(&fixture_str, &[], true, 50)
            .await
            .expect("reabrir el archivo guardado deberia funcionar");
        let refetched = session2
            .get_field(target.index)
            .await
            .expect("get_field deberia funcionar tras reabrir");
        assert_eq!(refetched.value.expect("no deberia ser nil").display, "777");
        session2.shutdown().await;

        cleanup_fixture(&fixture);
    }
}
