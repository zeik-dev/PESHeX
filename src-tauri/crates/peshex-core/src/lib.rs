//! Logica de PESHeX que no necesita Tauri (y por eso se puede probar en cualquier sistema).
//!
//! * [`fsutil`]: escritura atomica de JSON y el hash que da nombre a las carpetas de cache.
//! * [`winstate`]: estado de la ventana (maximizada, monitor, tamano) y su colocacion centrada al arrancar.

pub mod fsutil;
pub mod winstate;

#[cfg(test)]
pub(crate) mod testutil;
