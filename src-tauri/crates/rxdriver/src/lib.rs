//! Ciclo de vida y protocolo del proceso hijo `rxdata_driver.rb`.
//!
//! Protocolo: una linea JSON de peticion -> exactamente una linea JSON de
//! respuesta, en orden, nunca dos comandos en vuelo a la vez (lo garantiza
//! el Mutex que envuelve la sesion en la app). El campo `id` es solo un
//! chequeo defensivo de desincronizacion del stream de lineas.
//!
//! Este crate NO depende de Tauri: asi `cargo test -p rxdriver` corre en
//! cualquier maquina con `ruby` en el PATH (CI Linux incluido).

use serde::Serialize;
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
    Logical {
        kind: String,
        message: String,
        params: Option<Value>,
    },
    Fatal(String),
}

impl DriverCallError {
    pub fn message(&self) -> String {
        match self {
            DriverCallError::Logical { message, .. } => message.clone(),
            DriverCallError::Fatal(m) => m.clone(),
        }
    }

    pub fn is_fatal(&self) -> bool {
        matches!(self, DriverCallError::Fatal(_))
    }

    /// Error serializable para el frontend: `kind` + `params` permiten
    /// traducirlo; `message` queda como texto de respaldo.
    pub fn to_dto(&self) -> DriverErrorDto {
        match self {
            DriverCallError::Logical {
                kind,
                message,
                params,
            } => DriverErrorDto {
                kind: kind.clone(),
                message: message.clone(),
                params: params.clone(),
                fatal: false,
            },
            DriverCallError::Fatal(message) => DriverErrorDto {
                kind: "Fatal".to_string(),
                message: message.clone(),
                params: None,
                fatal: true,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DriverErrorDto {
    pub kind: String,
    pub message: String,
    pub params: Option<Value>,
    pub fatal: bool,
}

impl DriverErrorDto {
    pub fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.to_string(),
            message: message.into(),
            params: None,
            fatal: false,
        }
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

    /// Envia un comando y devuelve la respuesta completa (`ok:true`). Un
    /// `ok:false` del driver se convierte en `DriverCallError::Logical`.
    pub async fn call(&mut self, cmd: &str, params: Value) -> Result<Value, DriverCallError> {
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
                "el proceso Ruby se desincronizo en '{cmd}' (esperaba id {id}, recibio {resp_id:?})"
            )));
        }

        if response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
            Ok(response)
        } else {
            let error = response.get("error");
            let text = |key: &str| {
                error
                    .and_then(|e| e.get(key))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            };
            Err(DriverCallError::Logical {
                kind: text("type").unwrap_or_else(|| "DriverError".to_string()),
                message: text("message")
                    .unwrap_or_else(|| "error desconocido del driver".to_string()),
                params: error.and_then(|e| e.get("params")).cloned(),
            })
        }
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
