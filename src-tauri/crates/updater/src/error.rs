//! Errores del actualizador. Cada uno tiene un `code()` estable que la interfaz traduce (el mensaje es solo para el registro).

use std::fmt;
use std::io;

#[derive(Debug)]
pub enum UpdateError {
    /// Sin conexion, DNS, TLS, tiempo agotado...
    Network(String),
    /// Respuesta HTTP inesperada.
    Http(u16),
    /// GitHub limita las consultas anonimas (60 por hora).
    RateLimited,
    /// El repositorio no tiene ningun Release publicado.
    NoRelease,
    /// El Release no trae el zip de Windows esperado.
    NoAsset(String),
    /// El Release no trae `SHA256SUMS.txt` o no lista el zip.
    NoChecksum(String),
    /// La URL no es de GitHub (o no es https).
    HostNotAllowed(String),
    HashMismatch { expected: String, actual: String },
    SizeMismatch { expected: u64, actual: u64 },
    /// Zip corrupto, con rutas peligrosas o que no coincide con su `CONTENIDO.sha256`.
    BadArchive(String),
    /// La carpeta de PESHeX no admite escritura (p. ej. Archivos de programa) o PESHeX sigue abierto.
    NotWritable(String),
    Io(String),
    Invalid(String),
    /// El usuario cancelo: se borra lo descargado.
    Cancelled,
    /// Se cerro la app durante la descarga: se conserva lo descargado para reanudar.
    Aborted,
}

impl UpdateError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Network(_) => "network",
            Self::Http(_) => "http",
            Self::RateLimited => "rate_limited",
            Self::NoRelease => "no_release",
            Self::NoAsset(_) => "no_asset",
            Self::NoChecksum(_) => "no_checksum",
            Self::HostNotAllowed(_) => "host_not_allowed",
            Self::HashMismatch { .. } => "hash_mismatch",
            Self::SizeMismatch { .. } => "size_mismatch",
            Self::BadArchive(_) => "bad_archive",
            Self::NotWritable(_) => "not_writable",
            Self::Io(_) => "io",
            Self::Invalid(_) => "invalid",
            Self::Cancelled => "cancelled",
            Self::Aborted => "aborted",
        }
    }
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Network(m) => write!(f, "error de red: {m}"),
            Self::Http(s) => write!(f, "el servidor respondio {s}"),
            Self::RateLimited => write!(f, "GitHub limito las consultas; vuelve a intentarlo mas tarde"),
            Self::NoRelease => write!(f, "no hay ningun Release publicado"),
            Self::NoAsset(n) => write!(f, "el Release no incluye {n}"),
            Self::NoChecksum(n) => write!(f, "el Release no trae la huella SHA-256 de {n}"),
            Self::HostNotAllowed(u) => write!(f, "direccion no permitida: {u}"),
            Self::HashMismatch { expected, actual } => write!(f, "la huella SHA-256 no coincide (esperada {expected}, obtenida {actual})"),
            Self::SizeMismatch { expected, actual } => write!(f, "el tamaño no coincide (esperado {expected} bytes, obtenido {actual})"),
            Self::BadArchive(m) => write!(f, "el paquete no es valido: {m}"),
            Self::NotWritable(m) => write!(f, "no se puede escribir en la carpeta de PESHeX: {m}"),
            Self::Io(m) => write!(f, "error de disco: {m}"),
            Self::Invalid(m) => write!(f, "{m}"),
            Self::Cancelled => write!(f, "actualizacion cancelada"),
            Self::Aborted => write!(f, "actualizacion interrumpida"),
        }
    }
}

impl std::error::Error for UpdateError {}

impl From<io::Error> for UpdateError {
    fn from(e: io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl From<zip::result::ZipError> for UpdateError {
    fn from(e: zip::result::ZipError) -> Self {
        Self::BadArchive(e.to_string())
    }
}
