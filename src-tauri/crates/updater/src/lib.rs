//! Actualizador de PESHeX (GitHub Releases).
//!
//! Se distribuye como `PESHeX-Updater.exe` junto a `PESHeX.exe`. La app lo copia a una carpeta temporal y lo ejecuta desde alli para
//! que pueda reemplazar tambien su propio ejecutable; le da ordenes por stdin y recibe el progreso por stdout (ver `session`).
//!
//! Garantias y limites:
//! * Solo habla con GitHub por https y comprueba cada redireccion (`http`).
//! * Comprueba el SHA-256 del zip contra el `SHA256SUMS.txt` del MISMO Release y el contenido contra `CONTENIDO.sha256`: detecta
//!   descargas corruptas o incompletas. No prueba la autoria (el ejecutable no esta firmado): quien controle el Release controla el contenido.
//! * El reemplazo guarda lo antiguo y lo restaura si algo falla (`apply`).

pub mod apply;
pub mod download;
pub mod error;
pub mod github;
pub mod http;
pub mod session;
pub mod sums;
pub mod version;

pub use error::UpdateError;

pub type Result<T> = std::result::Result<T, UpdateError>;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// Repositorio del que se descargan las versiones.
pub const REPO: &str = "zeik-dev/PESHeX";
/// Ejecutable principal dentro del paquete.
pub const MAIN_EXE: &str = "PESHeX.exe";
