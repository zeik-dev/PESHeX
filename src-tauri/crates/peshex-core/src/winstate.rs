//! Estado de la ventana principal: si estaba maximizada, en que monitor y con que tamano.
//!
//! Al arrancar, la ventana se crea OCULTA, se coloca con [`place`] (centrada en el area de trabajo del monitor recordado, o
//! del principal) y solo entonces se muestra: nunca aparece en una posicion y salta a otra. Todo esto es aritmetica pura, sin
//! Tauri, para poder probarla en cualquier sistema; `src-tauri/src/winstate.rs` la conecta con la ventana real.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::fsutil::{read_json, write_json};

/// Un monitor tal como lo informa el sistema (todo en pixeles fisicos).
#[derive(Clone, Debug, PartialEq)]
pub struct MonitorInfo {
    pub name: Option<String>,
    /// Esquina superior izquierda y tamano del monitor completo.
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// Area de trabajo (sin barra de tareas).
    pub work_x: i32,
    pub work_y: i32,
    pub work_width: u32,
    pub work_height: u32,
    /// Factor de escala (1.0 = 100 %, 1.5 = 150 %...).
    pub scale: f64,
}

/// Monitor en el que estaba la ventana, para reconocerlo al volver a abrir.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedMonitor {
    pub name: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl From<&MonitorInfo> for SavedMonitor {
    fn from(m: &MonitorInfo) -> Self {
        SavedMonitor { name: m.name.clone(), x: m.x, y: m.y, width: m.width, height: m.height }
    }
}

/// Lo que se recuerda de la ventana entre ejecuciones.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SavedWindow {
    /// Estaba maximizada al cerrar.
    pub maximized: bool,
    pub monitor: Option<SavedMonitor>,
    /// Tamano de la ventana RESTAURADA (no maximizada), en pixeles logicos: asi vale aunque el monitor cambie de escala.
    pub width: f64,
    pub height: f64,
}

/// Donde y como crear la ventana.
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    /// Indice (en la lista de monitores recibida) del monitor elegido.
    pub monitor: usize,
    /// Esquina superior izquierda de la ventana, en pixeles fisicos de pantalla.
    pub x: i32,
    pub y: i32,
    /// Tamano a pedir (el INTERIOR de la ventana, como `width`/`height` de `tauri.conf.json`), en pixeles fisicos. La posicion de
    /// arriba supone que el marco no suma nada; el llamador la afina con [`center_in_work_area`] y el tamano exterior real.
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

/// Elige el monitor guardado entre los disponibles: el mismo nombre y posicion, luego la misma geometria, luego el mismo
/// nombre (el usuario recoloco las pantallas); si ya no esta, el principal.
pub fn pick_monitor(saved: Option<&SavedMonitor>, monitors: &[MonitorInfo], primary: usize) -> usize {
    let fallback = primary.min(monitors.len().saturating_sub(1));
    let Some(s) = saved else { return fallback };
    let same_pos = |m: &MonitorInfo| m.x == s.x && m.y == s.y;
    let same_geo = |m: &MonitorInfo| same_pos(m) && m.width == s.width && m.height == s.height;
    let same_name = |m: &MonitorInfo| s.name.is_some() && m.name == s.name;
    monitors
        .iter()
        .position(|m| same_name(m) && same_pos(m))
        .or_else(|| monitors.iter().position(same_geo))
        .or_else(|| monitors.iter().position(same_name))
        .unwrap_or(fallback)
}

/// Esquina superior izquierda para que una ventana de `width` x `height` (fisicos, TAMANO EXTERIOR) quede exactamente centrada
/// en el area de trabajo del monitor. En i64: nada se desborda con monitores de coordenadas negativas.
pub fn center_in_work_area(m: &MonitorInfo, width: u32, height: u32) -> (i32, i32) {
    let cx = i64::from(m.work_x) + (i64::from(m.work_width) - i64::from(width)) / 2;
    let cy = i64::from(m.work_y) + (i64::from(m.work_height) - i64::from(height)) / 2;
    (cx.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32, cy.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32)
}

/// Calcula la colocacion de la ventana. `default_logical` es el tamano de `tauri.conf.json` y `min_logical` su minimo (ambos
/// en pixeles logicos). Devuelve `None` si no hay ningun monitor (el llamador deja el centrado por defecto).
pub fn place(
    saved: Option<&SavedWindow>,
    monitors: &[MonitorInfo],
    primary: usize,
    default_logical: (f64, f64),
    min_logical: (f64, f64),
) -> Option<Placement> {
    if monitors.is_empty() {
        return None;
    }
    let idx = pick_monitor(saved.and_then(|s| s.monitor.as_ref()), monitors, primary);
    let m = &monitors[idx];
    let scale = if m.scale.is_finite() && m.scale > 0.0 { m.scale } else { 1.0 };

    let (lw, lh) = saved.map_or(default_logical, |s| (s.width, s.height));
    let fit = |logical: f64, min: f64, avail: u32| -> u32 {
        let want = (logical * scale).round().max((min * scale).round()).max(1.0);
        (want.min(f64::from(avail.max(1)))) as u32
    };
    let width = fit(lw, min_logical.0, m.work_width);
    let height = fit(lh, min_logical.1, m.work_height);

    let (x, y) = center_in_work_area(m, width, height);
    Some(Placement { monitor: idx, x, y, width, height, maximized: saved.is_some_and(|s| s.maximized) })
}

/// Sigue los cambios de la ventana mientras la app corre y decide que se guarda.
///
/// Solo la geometria de la ventana RESTAURADA cuenta como tamano recordado: al maximizar, el sistema manda eventos de
/// tamano con el de la pantalla completa, que no debe sobrescribir el de antes.
#[derive(Clone, Debug, Default)]
pub struct Tracker {
    state: Option<SavedWindow>,
    dirty: bool,
}

impl Tracker {
    pub fn new(saved: Option<SavedWindow>) -> Self {
        Tracker { state: saved, dirty: false }
    }

    /// La ventana (no maximizada, no minimizada, no a pantalla completa) tiene este tamano fisico en este monitor.
    pub fn record_normal(&mut self, physical_width: u32, physical_height: u32, monitor: &MonitorInfo) {
        let scale = if monitor.scale.is_finite() && monitor.scale > 0.0 { monitor.scale } else { 1.0 };
        if physical_width == 0 || physical_height == 0 {
            return; // minimizada: el sistema informa 0x0
        }
        let next = SavedWindow {
            maximized: false,
            monitor: Some(SavedMonitor::from(monitor)),
            width: (f64::from(physical_width) / scale).round(),
            height: (f64::from(physical_height) / scale).round(),
        };
        self.set(next);
    }

    /// Cambia el estado maximizado/restaurado conservando el ultimo tamano restaurado conocido.
    pub fn record_maximized(&mut self, maximized: bool, monitor: &MonitorInfo) {
        let mut next = self
            .state
            .clone()
            .unwrap_or(SavedWindow { maximized, monitor: None, width: 0.0, height: 0.0 });
        next.maximized = maximized;
        next.monitor = Some(SavedMonitor::from(monitor));
        self.set(next);
    }

    fn set(&mut self, next: SavedWindow) {
        if self.state.as_ref() != Some(&next) {
            self.state = Some(next);
            self.dirty = true;
        }
    }

    /// Lo que habria que guardar ahora (`None` si no hay nada util: p. ej. nunca se supo el tamano).
    pub fn snapshot(&self) -> Option<&SavedWindow> {
        self.state.as_ref().filter(|s| s.width > 0.0 && s.height > 0.0)
    }

    /// ¿Hay cambios sin guardar?
    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// ¿Hay cambios sin guardar? Al devolverlo, la marca se limpia.
    pub fn take_dirty(&mut self) -> bool {
        std::mem::take(&mut self.dirty)
    }
}

/// Lee el estado guardado; `None` si no existe, esta danado o no tiene un tamano razonable.
pub fn load(path: &Path) -> Option<SavedWindow> {
    read_json::<SavedWindow>(path).filter(|s| s.width.is_finite() && s.height.is_finite() && s.width >= 100.0 && s.height >= 100.0)
}

/// Guarda el estado de forma atomica.
pub fn save(path: &Path, state: &SavedWindow) -> std::io::Result<()> {
    write_json(path, state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Tmp;

    fn mon(name: &str, x: i32, y: i32, w: u32, h: u32, scale: f64) -> MonitorInfo {
        // Barra de tareas de 40 px abajo en todos.
        MonitorInfo { name: Some(name.into()), x, y, width: w, height: h, work_x: x, work_y: y, work_width: w, work_height: h - 40, scale }
    }

    const DEFAULT: (f64, f64) = (1100.0, 720.0);
    const MIN: (f64, f64) = (900.0, 600.0);

    #[test]
    fn sin_estado_se_centra_en_el_monitor_principal_con_el_tamano_por_defecto() {
        let monitors = [mon("A", 0, 0, 1920, 1080, 1.0), mon("B", 1920, 0, 2560, 1440, 1.0)];
        let p = place(None, &monitors, 1, DEFAULT, MIN).unwrap();
        assert_eq!(p.monitor, 1);
        assert_eq!((p.width, p.height), (1100, 720));
        // area de trabajo de B: 2560 x 1400 desde (1920, 0)
        assert_eq!((p.x, p.y), (1920 + (2560 - 1100) / 2, (1400 - 720) / 2));
        assert!(!p.maximized);
    }

    #[test]
    fn recuerda_el_monitor_y_el_tamano_restaurado() {
        let monitors = [mon("A", 0, 0, 1920, 1080, 1.0), mon("B", 1920, 0, 2560, 1440, 1.0)];
        let saved = SavedWindow { maximized: false, monitor: Some(SavedMonitor::from(&monitors[0])), width: 1400.0, height: 800.0 };
        let p = place(Some(&saved), &monitors, 1, DEFAULT, MIN).unwrap();
        assert_eq!(p.monitor, 0, "el monitor recordado manda sobre el principal");
        assert_eq!((p.width, p.height), (1400, 800));
        assert_eq!((p.x, p.y), ((1920 - 1400) / 2, (1040 - 800) / 2), "centrada exactamente en su area de trabajo");
    }

    #[test]
    fn maximizada_se_abre_sobre_el_monitor_recordado() {
        let monitors = [mon("A", 0, 0, 1920, 1080, 1.0), mon("B", 1920, 0, 2560, 1440, 1.0)];
        let saved = SavedWindow { maximized: true, monitor: Some(SavedMonitor::from(&monitors[1])), width: 1100.0, height: 720.0 };
        let p = place(Some(&saved), &monitors, 0, DEFAULT, MIN).unwrap();
        assert!(p.maximized);
        assert_eq!(p.monitor, 1);
        assert!(p.x >= 1920, "la ventana restaurada esta dentro del monitor B para que Windows la maximice alli");
    }

    #[test]
    fn si_el_monitor_ya_no_existe_va_al_principal() {
        let monitors = [mon("A", 0, 0, 1920, 1080, 1.0)];
        let gone = SavedMonitor { name: Some("TV".into()), x: 3840, y: 0, width: 3840, height: 2160 };
        let saved = SavedWindow { maximized: false, monitor: Some(gone), width: 1200.0, height: 700.0 };
        let p = place(Some(&saved), &monitors, 0, DEFAULT, MIN).unwrap();
        assert_eq!(p.monitor, 0);
        assert_eq!((p.width, p.height), (1200, 700));
    }

    #[test]
    fn un_monitor_recolocado_se_reconoce_por_el_nombre() {
        let moved = mon("DELL", 1920, 0, 1920, 1080, 1.0);
        let monitors = [mon("A", 0, 0, 1920, 1080, 1.0), moved];
        let before = SavedMonitor { name: Some("DELL".into()), x: -1920, y: 0, width: 1920, height: 1080 };
        assert_eq!(pick_monitor(Some(&before), &monitors, 0), 1);
    }

    #[test]
    fn el_tamano_se_recorta_al_area_de_trabajo_y_respeta_el_minimo() {
        let monitors = [mon("A", 0, 0, 1280, 720, 1.0)];
        let big = SavedWindow { maximized: false, monitor: None, width: 3000.0, height: 3000.0 };
        let p = place(Some(&big), &monitors, 0, DEFAULT, MIN).unwrap();
        assert_eq!((p.width, p.height), (1280, 680));
        assert_eq!((p.x, p.y), (0, 0));
        let tiny = SavedWindow { maximized: false, monitor: None, width: 10.0, height: 10.0 };
        let q = place(Some(&tiny), &monitors, 0, DEFAULT, MIN).unwrap();
        assert_eq!((q.width, q.height), (900, 600));
    }

    #[test]
    fn la_escala_del_monitor_convierte_el_tamano_logico() {
        // 150 %: la misma ventana logica ocupa 1.5x pixeles fisicos.
        let monitors = [mon("HiDPI", 0, 0, 3840, 2160, 1.5)];
        let p = place(None, &monitors, 0, DEFAULT, MIN).unwrap();
        assert_eq!((p.width, p.height), (1650, 1080));
        assert_eq!((p.x, p.y), ((3840 - 1650) / 2, (2120 - 1080) / 2));
    }

    #[test]
    fn monitores_con_coordenadas_negativas_se_centran_bien() {
        let monitors = [mon("Izq", -1920, -200, 1920, 1080, 1.0), mon("Principal", 0, 0, 1920, 1080, 1.0)];
        let saved = SavedWindow { maximized: false, monitor: Some(SavedMonitor::from(&monitors[0])), width: 1100.0, height: 720.0 };
        let p = place(Some(&saved), &monitors, 1, DEFAULT, MIN).unwrap();
        assert_eq!(p.monitor, 0);
        assert_eq!((p.x, p.y), (-1920 + (1920 - 1100) / 2, -200 + (1040 - 720) / 2));
    }

    #[test]
    fn el_centrado_usa_el_tamano_exterior() {
        let m = mon("A", 0, 0, 1920, 1080, 1.0); // area de trabajo 1920 x 1040
        assert_eq!(center_in_work_area(&m, 1100, 760), (410, 140));
        // ventana mas grande que el area: coordenada negativa, sin desbordar
        assert_eq!(center_in_work_area(&m, 2000, 1100), (-40, -30));
    }

    #[test]
    fn sin_monitores_no_hay_colocacion() {
        assert!(place(None, &[], 0, DEFAULT, MIN).is_none());
    }

    #[test]
    fn el_seguimiento_ignora_el_tamano_de_la_ventana_maximizada() {
        let a = mon("A", 0, 0, 1920, 1080, 1.0);
        let mut t = Tracker::new(None);
        assert!(t.snapshot().is_none(), "sin datos no se guarda nada");
        t.record_normal(1100, 720, &a);
        assert!(t.take_dirty());
        assert!(!t.take_dirty(), "la marca se limpia");
        t.record_maximized(true, &a);
        // el sistema manda ahora el tamano de pantalla completa: el llamador NO lo registra como normal.
        let s = t.snapshot().unwrap();
        assert!(s.maximized);
        assert_eq!((s.width, s.height), (1100.0, 720.0), "se conserva el tamano restaurado");
        t.record_maximized(false, &a);
        assert!(!t.snapshot().unwrap().maximized);
    }

    #[test]
    fn registrar_lo_mismo_no_ensucia_y_la_ventana_minimizada_se_ignora() {
        let a = mon("A", 0, 0, 1920, 1080, 1.0);
        let mut t = Tracker::new(None);
        t.record_normal(1000, 700, &a);
        assert!(t.take_dirty());
        t.record_normal(1000, 700, &a);
        assert!(!t.take_dirty());
        t.record_normal(0, 0, &a); // minimizada
        assert!(!t.take_dirty());
        assert_eq!(t.snapshot().unwrap().width, 1000.0);
    }

    #[test]
    fn el_tamano_guardado_se_expresa_en_pixeles_logicos() {
        let hi = mon("HiDPI", 0, 0, 3840, 2160, 2.0);
        let mut t = Tracker::new(None);
        t.record_normal(2200, 1440, &hi);
        let s = t.snapshot().unwrap();
        assert_eq!((s.width, s.height), (1100.0, 720.0));
    }

    #[test]
    fn guardar_y_cargar_ida_y_vuelta_y_rechazar_basura() {
        let tmp = Tmp::new("winstate");
        let path = tmp.path().join("window-state.json");
        assert!(load(&path).is_none());
        let a = mon("A", 0, 0, 1920, 1080, 1.0);
        let s = SavedWindow { maximized: true, monitor: Some(SavedMonitor::from(&a)), width: 1234.0, height: 777.0 };
        save(&path, &s).unwrap();
        assert_eq!(load(&path), Some(s));
        std::fs::write(&path, br#"{"maximized":false,"monitor":null,"width":5,"height":-3}"#).unwrap();
        assert!(load(&path).is_none(), "un tamano absurdo no se restaura");
        std::fs::write(&path, b"no json").unwrap();
        assert!(load(&path).is_none());
    }
}
