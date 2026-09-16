use crate::driver_process::DriverSession;
use tokio::sync::Mutex;

/// v1 solo soporta un archivo abierto a la vez, igual que el CLI original:
/// abrir uno nuevo cierra el anterior. El Mutex se retiene durante todo el
/// intercambio peticion/respuesta con el proceso Ruby, lo que ya garantiza
/// que nunca hay dos comandos en vuelo a la vez (ver driver_process.rs).
#[derive(Default)]
pub struct AppState {
    pub driver: Mutex<Option<DriverSession>>,
}
