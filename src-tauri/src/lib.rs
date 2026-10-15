mod commands;
mod game;
mod state;
mod winstate;

use tauri::Manager;

/// WebView2 es el unico requisito externo en Windows. Sin el, Tauri solo
/// mostraria un error en ingles: aqui se explica en español y se ofrece la descarga.
#[cfg(windows)]
mod webview_notice {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;

    const DOWNLOAD_URL: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    const MB_YESNO: u32 = 0x0000_0004;
    const MB_ICONERROR: u32 = 0x0000_0010;
    const IDYES: i32 = 6;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut c_void, text: *const u16, caption: *const u16, utype: u32) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn ask(title: &str, text: &str) -> bool {
        let (t, c) = (wide(text), wide(title));
        // SAFETY: punteros a buffers terminados en NUL que viven durante la llamada.
        unsafe { MessageBoxW(std::ptr::null_mut(), t.as_ptr(), c.as_ptr(), MB_YESNO | MB_ICONERROR) == IDYES }
    }

    /// Muestra el aviso; si el usuario acepta, abre la pagina de descarga de WebView2.
    pub fn show_missing_webview() {
        let text = "PESHeX necesita Microsoft Edge WebView2 y no está instalado en este equipo.\n\n\
                    Viene incluido en Windows 11 y en Windows 10 actualizado. Puedes instalarlo \
                    gratis desde la página de Microsoft.\n\n¿Abrir la página de descarga ahora?";
        if ask("PESHeX", text) {
            let _ = std::process::Command::new("cmd")
                .args(["/C", "start", "", DOWNLOAD_URL])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        }
    }

    /// Cualquier otro error fatal al arrancar (con el detalle tecnico).
    pub fn show_fatal(detail: &str) {
        let (t, c) = (
            wide(&format!("PESHeX no pudo iniciarse.\n\n{detail}")),
            wide("PESHeX"),
        );
        // SAFETY: igual que arriba.
        unsafe { MessageBoxW(std::ptr::null_mut(), t.as_ptr(), c.as_ptr(), MB_ICONERROR) };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    if tauri::webview_version().is_err() {
        webview_notice::show_missing_webview();
        return;
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        // La ventana principal la crea `winstate` (oculta, colocada y despues mostrada), no Tauri al arrancar.
        .setup(|app| winstate::init(app))
        .invoke_handler(tauri::generate_handler![
            commands::check_file,
            commands::open_save,
            commands::close_save,
            commands::driver_call,
            game::scan_game_folder,
            game::forget_game_folder,
            game::read_game_file,
            game::assetmap_load,
            game::assetmap_save,
        ])
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(e) => {
            #[cfg(windows)]
            webview_notice::show_fatal(&e.to_string());
            eprintln!("error while building tauri application: {e}");
            std::process::exit(1);
        }
    };

    app.run(|app_handle, event| {
        // Best-effort: nunca dejar un ruby.exe huerfano al cerrar la app.
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<state::AppState>() {
                if let Ok(mut guard) = state.driver.try_lock() {
                    if let Some(session) = guard.as_mut() {
                        session.kill_blocking();
                    }
                }
            }
        }
    });
}
