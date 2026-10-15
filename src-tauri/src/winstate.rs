//! Estado de la ventana principal: se recuerda si estaba maximizada, en que monitor y con que tamano.
//!
//! La ventana NO la crea Tauri al arrancar (`"create": false` en `tauri.conf.json`): se crea aqui oculta, se coloca (centrada
//! en el area de trabajo del monitor recordado, o del principal; maximizada si lo estaba) y solo entonces se muestra. Asi nunca
//! se ve aparecer en un sitio y saltar a otro. La aritmetica esta en `peshex_core::winstate`, que se prueba sin Tauri.

use std::error::Error;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use peshex_core::winstate::{self, MonitorInfo, Tracker};
use tauri::{App, AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const FILE: &str = "window-state.json";
/// Entre escrituras a disco mientras se arrastra o redimensiona la ventana (el cierre siempre guarda).
const WRITE_EVERY: Duration = Duration::from_millis(1500);

struct Shared {
    path: Option<PathBuf>,
    tracker: Mutex<Tracker>,
    last_write: Mutex<Option<Instant>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // Un panico en otro hilo no debe impedir guardar el estado de la ventana.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn info_of(m: &Monitor) -> MonitorInfo {
    let wa = m.work_area();
    MonitorInfo {
        name: m.name().cloned(),
        x: m.position().x,
        y: m.position().y,
        width: m.size().width,
        height: m.size().height,
        work_x: wa.position.x,
        work_y: wa.position.y,
        work_width: wa.size.width,
        work_height: wa.size.height,
        scale: m.scale_factor(),
    }
}

/// Crea la ventana principal colocada segun el estado recordado. Si algo falla, cae a la ventana normal de `tauri.conf.json`
/// (centrada por Tauri): la app nunca se queda sin ventana por culpa de este modulo.
pub fn init(app: &mut App) -> Result<(), Box<dyn Error>> {
    let cfg = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or("tauri.conf.json no define la ventana principal")?;
    match build_placed(app.handle(), &cfg) {
        Ok(()) => Ok(()),
        Err(e) => {
            eprintln!("no se pudo colocar la ventana ({e}); se crea con los valores por defecto");
            if app.get_webview_window(&cfg.label).is_none() {
                WebviewWindowBuilder::from_config(app.handle(), &cfg)?.center().build()?;
            }
            Ok(())
        }
    }
}

fn build_placed(handle: &AppHandle, cfg: &tauri::utils::config::WindowConfig) -> Result<(), Box<dyn Error>> {
    let path = handle.path().app_data_dir().ok().map(|d| d.join(FILE));
    let saved = path.as_deref().and_then(winstate::load);

    let monitors: Vec<Monitor> = handle.available_monitors().unwrap_or_default();
    let infos: Vec<MonitorInfo> = monitors.iter().map(info_of).collect();
    let primary = handle.primary_monitor().ok().flatten();
    let primary_idx = primary
        .as_ref()
        .and_then(|p| monitors.iter().position(|m| m.position() == p.position() && m.size() == p.size()))
        .unwrap_or(0);
    let min = (cfg.min_width.unwrap_or(0.0), cfg.min_height.unwrap_or(0.0));
    let placement = winstate::place(saved.as_ref(), &infos, primary_idx, (cfg.width, cfg.height), min);

    // Oculta hasta estar colocada.
    let window = WebviewWindowBuilder::from_config(handle, cfg)?.visible(false).build()?;
    if let Some(p) = &placement {
        window.set_size(PhysicalSize::new(p.width, p.height))?;
        // El marco suma al tamano interior: se vuelve a centrar con el tamano EXTERIOR real.
        let outer = window.outer_size().unwrap_or(PhysicalSize::new(p.width, p.height));
        let (x, y) = winstate::center_in_work_area(&infos[p.monitor], outer.width, outer.height);
        window.set_position(PhysicalPosition::new(x, y))?;
        if p.maximized {
            window.maximize()?;
        }
    } else {
        window.center()?;
    }
    window.show()?;

    let shared = Arc::new(Shared { path, tracker: Mutex::new(Tracker::new(saved)), last_write: Mutex::new(None) });
    let w = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => capture(&w, &shared, false),
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => capture(&w, &shared, true),
        _ => {}
    });
    Ok(())
}

/// Anota el estado actual de la ventana y, si toca, lo guarda en disco.
fn capture(w: &WebviewWindow, shared: &Shared, force: bool) {
    // Minimizada o a pantalla completa: el sistema informa tamanos que no son los de la ventana restaurada.
    let hidden_or_full = w.is_minimized().unwrap_or(false) || w.is_fullscreen().unwrap_or(false);
    if !hidden_or_full {
        if let Ok(Some(monitor)) = w.current_monitor() {
            let info = info_of(&monitor);
            let mut t = lock(&shared.tracker);
            if w.is_maximized().unwrap_or(false) {
                t.record_maximized(true, &info);
            } else if let Ok(size) = w.inner_size() {
                t.record_normal(size.width, size.height, &info);
            }
        }
    }
    flush(shared, force);
}

fn flush(shared: &Shared, force: bool) {
    let Some(path) = &shared.path else { return };
    {
        let mut last = lock(&shared.last_write);
        if !force && last.is_some_and(|t| t.elapsed() < WRITE_EVERY) {
            return;
        }
        *last = Some(Instant::now());
    }
    let mut t = lock(&shared.tracker);
    if !t.is_dirty() {
        return;
    }
    if let Some(state) = t.snapshot().cloned() {
        if winstate::save(path, &state).is_ok() {
            t.take_dirty();
        }
    }
}
