//! Logica de PESHeX que no necesita Tauri (y por eso se puede probar en cualquier sistema).
//!
//! * [`fsutil`]: escritura atomica de JSON y el hash que da nombre a las carpetas de cache.
//! * [`logfile`]: el registro de diagnostico (`updater.log`), que nunca falla y se recorta solo.
//! * [`registry`]: la biblioteca de juegos registrados (`games.json`).
//! * [`savescan`]: donde guarda las partidas un juego y que archivos son partidas (nunca las copias `.bak`).
//! * [`winstate`]: estado de la ventana (maximizada, monitor, tamano) y su colocacion centrada al arrancar.

pub mod fsutil;
pub mod logfile;
pub mod registry;
pub mod savescan;
pub mod winstate;

#[cfg(test)]
pub(crate) mod testutil;
