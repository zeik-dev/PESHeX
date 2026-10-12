use std::path::PathBuf;
use std::sync::Mutex as StdMutex;

use rxdriver::DriverSession;
use tokio::sync::Mutex;

/// v1 solo soporta un archivo abierto a la vez, igual que el CLI original:
/// abrir uno nuevo cierra el anterior. El Mutex se retiene durante todo el
/// intercambio peticion/respuesta con el proceso Ruby, lo que ya garantiza
/// que nunca hay dos comandos en vuelo a la vez (ver crates/rxdriver).
#[derive(Default)]
pub struct AppState {
    pub driver: Mutex<Option<DriverSession>>,
    /// Raiz de la carpeta del juego vinculada (la fija `scan_game_folder`);
    /// `read_game_file` solo lee dentro de ella.
    pub game_root: StdMutex<Option<PathBuf>>,
}
