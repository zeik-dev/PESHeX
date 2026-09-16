mod commands;
mod driver_process;
mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::check_file,
            commands::open_save,
            commands::close_save,
            commands::list_fields,
            commands::get_field,
            commands::list_templates,
            commands::set_field,
            commands::list_changes,
            commands::nil_report,
            commands::save,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
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
