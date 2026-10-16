//! Vigilancia del save abierto: detecta que otro programa (p. ej. el juego, cuando el jugador guarda) lo reescribio.
//!
//! No usa notificaciones del sistema: compara la «huella» del archivo (tamano y fecha de modificacion) en cada sondeo. Es mas
//! robusto que vigilar la carpeta (los `.bak` y los `.tmp-<pid>` que escribe PESHeX viven al lado y los sincronizadores de
//! nube o las carpetas de red no avisan bien) y cubre las tres formas de guardar: escribir en el sitio, truncar y escribir, o
//! escribir un temporal y renombrarlo.
//!
//! [`Debounce`] es la parte pura: dice cuando una diferencia es un cambio de verdad (el archivo dejo de cambiar) y no el
//! juego aun escribiendo. [`SaveWatcher`] es el hilo que sondea y avisa con un callback (la aplicacion lo convierte en el
//! evento `save://changed`); las escrituras de PESHeX no avisan: se `pause`a la vigilancia mientras duran y despues se anota
//! la huella que dejaron como referencia.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, UNIX_EPOCH};

/// Sondeos seguidos que deben ver la MISMA huella nueva para dar el cambio por cierto (el juego ya termino de escribir).
pub const STABLE_POLLS: u32 = 2;

/// Huella de un archivo en un momento dado.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamp {
    pub len: u64,
    /// Fecha de modificacion en nanosegundos desde 1970 (0 si el sistema no la da).
    pub mtime_ns: u128,
}

/// Huella actual de `path`; `None` si no existe (o no es un archivo): entre borrar y renombrar, o si lo movieron.
pub fn stamp(path: &Path) -> Option<Stamp> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let mtime_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    Some(Stamp { len: meta.len(), mtime_ns })
}

/// Lo que dice un sondeo.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Nada que avisar (sin cambios, o cambiando aun).
    Quiet,
    /// El archivo cambio y ya esta estable: es la nueva huella (que pasa a ser la de referencia).
    Changed(Stamp),
}

/// Decide cuando una diferencia de huella es un cambio de verdad.
#[derive(Debug)]
pub struct Debounce {
    baseline: Option<Stamp>,
    candidate: Option<(Stamp, u32)>,
}

impl Debounce {
    pub fn new(baseline: Option<Stamp>) -> Self {
        Self { baseline, candidate: None }
    }

    /// Huella de referencia actual (la ultima que PESHeX leyo o escribio).
    pub fn baseline(&self) -> Option<Stamp> {
        self.baseline
    }

    /// Fija la referencia (tras abrir, guardar o recargar): lo que ya conoce PESHeX no es un cambio ajeno.
    pub fn set_baseline(&mut self, baseline: Option<Stamp>) {
        self.baseline = baseline;
        self.candidate = None;
    }

    /// Un sondeo. Ignora el archivo ausente (se esta renombrando) y el de largo 0 (el juego lo acaba de truncar y aun
    /// escribe); un cambio solo se da por cierto cuando [`STABLE_POLLS`] sondeos seguidos ven la misma huella, y se avisa
    /// una sola vez.
    pub fn observe(&mut self, now: Option<Stamp>) -> Verdict {
        let Some(now) = now else { return Verdict::Quiet };
        if Some(now) == self.baseline || now.len == 0 {
            self.candidate = None;
            return Verdict::Quiet;
        }
        match &mut self.candidate {
            Some((seen, polls)) if *seen == now => {
                *polls += 1;
                if *polls >= STABLE_POLLS {
                    self.baseline = Some(now);
                    self.candidate = None;
                    return Verdict::Changed(now);
                }
            }
            slot => *slot = Some((now, 1)),
        }
        Verdict::Quiet
    }
}

/// Cada cuanto se mira el archivo por defecto (un cambio se avisa tras `STABLE_POLLS` sondeos iguales, ~1,5 s).
pub const DEFAULT_POLL: Duration = Duration::from_millis(750);

/// Estado compartido entre el hilo y las ordenes que escriben el archivo.
struct Shared {
    debounce: Mutex<Debounce>,
    paused: AtomicBool,
    stop: AtomicBool,
}

struct Running {
    path: PathBuf,
    shared: Arc<Shared>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // Un hilo que entro en panico no debe tumbar el resto de la app: se sigue con el estado que quedo.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Vigila UN archivo (el save abierto) desde un hilo propio y avisa con un callback cuando otro programa lo reescribe.
pub struct SaveWatcher {
    poll: Duration,
    running: Mutex<Option<Running>>,
}

impl Default for SaveWatcher {
    fn default() -> Self {
        Self::new(DEFAULT_POLL)
    }
}

impl SaveWatcher {
    pub fn new(poll: Duration) -> Self {
        Self { poll, running: Mutex::new(None) }
    }

    /// Empieza a vigilar `path` (y deja de vigilar el anterior). `baseline` es la huella que tenia el archivo ANTES de que el
    /// driver lo leyera (si el juego guarda mientras se abre, el siguiente sondeo lo ve). `on_change` se llama desde el hilo
    /// de la vigilancia, una vez por cambio ya estable.
    pub fn start<F>(&self, path: PathBuf, baseline: Option<Stamp>, on_change: F)
    where
        F: Fn(&Path) + Send + 'static,
    {
        self.stop();
        let shared = Arc::new(Shared { debounce: Mutex::new(Debounce::new(baseline)), paused: AtomicBool::new(false), stop: AtomicBool::new(false) });
        let poll = self.poll;
        let (sh, p) = (shared.clone(), path.clone());
        let spawned = thread::Builder::new().name("peshex-save-watch".into()).spawn(move || {
            while !sh.stop.load(Ordering::Acquire) {
                thread::sleep(poll);
                if sh.stop.load(Ordering::Acquire) {
                    break;
                }
                if sh.paused.load(Ordering::Acquire) {
                    continue;
                }
                let now = stamp(&p);
                // Si mientras tanto empezo una escritura propia, esta lectura puede ser de a medias: se descarta.
                if sh.paused.load(Ordering::Acquire) {
                    continue;
                }
                let verdict = lock(&sh.debounce).observe(now);
                if matches!(verdict, Verdict::Changed(_)) && !sh.stop.load(Ordering::Acquire) {
                    on_change(&p);
                }
            }
        });
        // Sin hilo (casi imposible) no hay vigilancia, pero la app sigue funcionando.
        if spawned.is_ok() {
            *lock(&self.running) = Some(Running { path, shared });
        }
    }

    /// Deja de vigilar (el hilo termina en cuanto despierta; no se espera).
    pub fn stop(&self) {
        if let Some(r) = lock(&self.running).take() {
            r.shared.stop.store(true, Ordering::Release);
        }
    }

    /// Ruta que se esta vigilando (= el save abierto).
    pub fn path(&self) -> Option<PathBuf> {
        lock(&self.running).as_ref().map(|r| r.path.clone())
    }

    /// Fija la huella de referencia (lo que PESHeX ya leyo): no es un cambio ajeno.
    pub fn set_baseline(&self, baseline: Option<Stamp>) {
        if let Some(r) = lock(&self.running).as_ref() {
            lock(&r.shared.debounce).set_baseline(baseline);
        }
    }

    /// Una orden de PESHeX va a escribir el archivo: no se mira hasta que termine.
    pub fn pause(&self) {
        if let Some(r) = lock(&self.running).as_ref() {
            r.shared.paused.store(true, Ordering::Release);
        }
    }

    /// Termino la escritura propia. Con `wrote`, la huella nueva pasa a ser la de referencia; si no escribio nada (rechazada,
    /// con error...), se conserva la anterior para no tragarse un cambio ajeno que ocurriera en ese rato.
    pub fn resume(&self, wrote: bool) {
        if let Some(r) = lock(&self.running).as_ref() {
            let mut d = lock(&r.shared.debounce);
            if wrote {
                d.set_baseline(stamp(&r.path));
            }
            r.shared.paused.store(false, Ordering::Release);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Tmp;
    use std::fs;
    use std::time::{Duration, SystemTime};

    fn st(len: u64, mtime_ns: u128) -> Option<Stamp> {
        Some(Stamp { len, mtime_ns })
    }

    #[test]
    fn sin_cambios_no_avisa_nunca() {
        let mut d = Debounce::new(st(100, 1));
        for _ in 0..10 {
            assert_eq!(d.observe(st(100, 1)), Verdict::Quiet);
        }
    }

    #[test]
    fn avisa_una_sola_vez_cuando_la_huella_nueva_se_estabiliza() {
        let mut d = Debounce::new(st(100, 1));
        assert_eq!(d.observe(st(120, 2)), Verdict::Quiet, "el primer sondeo aun podria estar escribiendo");
        assert_eq!(d.observe(st(120, 2)), Verdict::Changed(Stamp { len: 120, mtime_ns: 2 }));
        // El cambio ya se aviso: seguir viendo lo mismo no avisa otra vez
        for _ in 0..5 {
            assert_eq!(d.observe(st(120, 2)), Verdict::Quiet);
        }
        assert_eq!(d.baseline(), st(120, 2));
    }

    #[test]
    fn si_el_archivo_sigue_cambiando_espera_a_que_pare() {
        let mut d = Debounce::new(st(100, 1));
        assert_eq!(d.observe(st(50, 2)), Verdict::Quiet);
        assert_eq!(d.observe(st(80, 3)), Verdict::Quiet);
        assert_eq!(d.observe(st(120, 4)), Verdict::Quiet);
        assert_eq!(d.observe(st(120, 4)), Verdict::Changed(Stamp { len: 120, mtime_ns: 4 }));
    }

    #[test]
    fn un_archivo_vacio_o_ausente_se_ignora() {
        let mut d = Debounce::new(st(100, 1));
        assert_eq!(d.observe(None), Verdict::Quiet);
        assert_eq!(d.observe(st(0, 2)), Verdict::Quiet);
        assert_eq!(d.observe(st(0, 2)), Verdict::Quiet, "truncado: el juego aun no escribio nada");
        // Reaparece completo
        assert_eq!(d.observe(st(130, 3)), Verdict::Quiet);
        assert_eq!(d.observe(None), Verdict::Quiet, "un renombrado en medio no reinicia la cuenta");
        assert_eq!(d.observe(st(130, 3)), Verdict::Changed(Stamp { len: 130, mtime_ns: 3 }));
    }

    #[test]
    fn volver_a_la_huella_de_referencia_cancela_el_cambio_pendiente() {
        let mut d = Debounce::new(st(100, 1));
        assert_eq!(d.observe(st(120, 2)), Verdict::Quiet);
        assert_eq!(d.observe(st(100, 1)), Verdict::Quiet);
        assert_eq!(d.observe(st(120, 2)), Verdict::Quiet, "la cuenta empieza de cero");
    }

    #[test]
    fn las_escrituras_propias_fijan_la_referencia_y_no_avisan() {
        let mut d = Debounce::new(st(100, 1));
        assert_eq!(d.observe(st(150, 2)), Verdict::Quiet); // PESHeX esta guardando...
        d.set_baseline(st(150, 2)); // ...y al terminar anota la huella nueva
        for _ in 0..5 {
            assert_eq!(d.observe(st(150, 2)), Verdict::Quiet);
        }
        // Y un cambio ajeno posterior si se detecta
        assert_eq!(d.observe(st(160, 3)), Verdict::Quiet);
        assert_eq!(d.observe(st(160, 3)), Verdict::Changed(Stamp { len: 160, mtime_ns: 3 }));
    }

    #[test]
    fn sin_referencia_inicial_el_primer_archivo_estable_cuenta_como_cambio() {
        let mut d = Debounce::new(None);
        assert_eq!(d.observe(st(10, 1)), Verdict::Quiet);
        assert_eq!(d.observe(st(10, 1)), Verdict::Changed(Stamp { len: 10, mtime_ns: 1 }));
    }

    #[test]
    fn la_huella_de_un_archivo_real_cambia_con_el_contenido_o_la_fecha() {
        let t = Tmp::new("watch");
        let p = t.write("Game.rxdata", b"uno");
        let a = stamp(&p).unwrap();
        assert_eq!(a.len, 3);
        assert_eq!(stamp(&p), Some(a), "estable mientras nadie lo toca");

        fs::write(&p, b"dos mas largo").unwrap();
        let b = stamp(&p).unwrap();
        assert_ne!(a, b);
        assert_eq!(b.len, 13);

        // Mismo tamano pero otra fecha de modificacion tambien es un cambio
        let later = SystemTime::now() + Duration::from_secs(60);
        fs::File::options().write(true).open(&p).unwrap().set_modified(later).unwrap();
        let c = stamp(&p).unwrap();
        assert_eq!(c.len, b.len);
        assert_ne!(b, c);
    }

    #[test]
    fn sin_archivo_o_con_una_carpeta_no_hay_huella() {
        let t = Tmp::new("watch");
        assert_eq!(stamp(&t.path().join("no_existe.rxdata")), None);
        assert_eq!(stamp(t.path()), None);
    }

    #[test]
    fn un_reemplazo_por_renombrado_se_ve_como_cambio() {
        let t = Tmp::new("watch");
        let p = t.write("Game.rxdata", b"original");
        let mut d = Debounce::new(stamp(&p));
        // Como el juego (o PESHeX): escribe un temporal y lo renombra encima
        let tmp = t.write("Game.rxdata.tmp-1", b"nuevo contenido");
        fs::rename(&tmp, &p).unwrap();
        assert_eq!(d.observe(stamp(&p)), Verdict::Quiet);
        assert!(matches!(d.observe(stamp(&p)), Verdict::Changed(s) if s.len == 15));
    }

    // ── El hilo de la vigilancia (sondeo muy corto para que las pruebas sean rapidas) ───────────────────────────────

    use std::sync::atomic::AtomicUsize;

    const TEST_POLL: Duration = Duration::from_millis(15);

    fn watcher_on(path: &Path) -> (SaveWatcher, Arc<AtomicUsize>) {
        let w = SaveWatcher::new(TEST_POLL);
        let hits = Arc::new(AtomicUsize::new(0));
        let h = hits.clone();
        w.start(path.to_path_buf(), stamp(path), move |_| {
            h.fetch_add(1, Ordering::SeqCst);
        });
        (w, hits)
    }

    fn wait_until(what: &str, cond: impl Fn() -> bool) {
        let t0 = std::time::Instant::now();
        while !cond() {
            assert!(t0.elapsed() < Duration::from_secs(5), "tiempo agotado esperando: {what}");
            thread::sleep(Duration::from_millis(5));
        }
    }

    /// Deja pasar varios sondeos para comprobar que NO pasa nada.
    fn settle() {
        thread::sleep(TEST_POLL * 12);
    }

    #[test]
    fn el_hilo_avisa_una_sola_vez_cuando_otro_programa_reescribe_el_save() {
        let t = Tmp::new("watch");
        let p = t.write("Game.rxdata", b"original");
        let (_w, hits) = watcher_on(&p);
        settle();
        assert_eq!(hits.load(Ordering::SeqCst), 0, "sin cambios no avisa");

        fs::write(&p, b"guardado desde el juego, mas largo").unwrap();
        wait_until("el aviso del cambio", || hits.load(Ordering::SeqCst) == 1);
        settle();
        assert_eq!(hits.load(Ordering::SeqCst), 1, "un cambio, un aviso");
    }

    #[test]
    fn el_hilo_espera_a_que_el_juego_termine_de_escribir() {
        let t = Tmp::new("watch");
        let p = t.write("Game.rxdata", b"original");
        let (_w, hits) = watcher_on(&p);
        // Truncado + escritura en trozos, como un guardado en el sitio
        fs::write(&p, b"").unwrap();
        settle();
        assert_eq!(hits.load(Ordering::SeqCst), 0);
        fs::write(&p, b"a medias").unwrap();
        thread::sleep(TEST_POLL / 2);
        fs::write(&p, b"a medias, un poco mas").unwrap();
        wait_until("el aviso", || hits.load(Ordering::SeqCst) >= 1);
        settle();
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn una_escritura_propia_no_avisa() {
        let t = Tmp::new("watch");
        let p = t.write("Game.rxdata", b"original");
        let (w, hits) = watcher_on(&p);

        // Como `driver_call("save")`: pausa, escribe (copia .bak + temporal + renombrado) y anota la huella nueva
        w.pause();
        t.write("Game.rxdata.20260101-000000.bak", b"original");
        let tmp = t.write("Game.rxdata.tmp-1", b"guardado desde PESHeX");
        fs::rename(&tmp, &p).unwrap();
        settle();
        w.resume(true);
        settle();
        assert_eq!(hits.load(Ordering::SeqCst), 0, "ni durante ni despues de guardar");

        // Y un cambio ajeno posterior si se detecta
        fs::write(&p, b"ahora si lo guardo el juego otra vez").unwrap();
        wait_until("el aviso del cambio ajeno", || hits.load(Ordering::SeqCst) == 1);
    }

    #[test]
    fn si_la_orden_no_escribio_un_cambio_ajeno_de_ese_rato_se_conserva() {
        let t = Tmp::new("watch");
        let p = t.write("Game.rxdata", b"original");
        let (w, hits) = watcher_on(&p);
        w.pause(); // guardar, pero la orden se rechaza (no escribe)...
        fs::write(&p, b"mientras tanto el juego guardo").unwrap(); // ...y el juego guarda en ese rato
        settle();
        w.resume(false);
        wait_until("el aviso", || hits.load(Ordering::SeqCst) == 1);
    }

    #[test]
    fn tras_recargar_la_referencia_es_la_de_antes_de_leer() {
        let t = Tmp::new("watch");
        let p = t.write("Game.rxdata", b"original");
        let (w, hits) = watcher_on(&p);
        let antes = stamp(&p);
        fs::write(&p, b"cambio ajeno ya leido por la recarga").unwrap();
        w.set_baseline(stamp(&p)); // la recarga lo leyo: no avisa
        settle();
        assert_eq!(hits.load(Ordering::SeqCst), 0);
        // Si la referencia fuese la de ANTES de leer y el archivo cambio durante la lectura, si avisa
        w.set_baseline(antes);
        wait_until("el aviso", || hits.load(Ordering::SeqCst) == 1);
    }

    #[test]
    fn parar_la_vigilancia_o_cambiar_de_archivo_silencia_la_anterior() {
        let t = Tmp::new("watch");
        let p = t.write("Uno.rxdata", b"uno");
        let q = t.write("Dos.rxdata", b"dos");
        let (w, hits) = watcher_on(&p);
        assert_eq!(w.path().as_deref(), Some(p.as_path()));

        let otros = Arc::new(AtomicUsize::new(0));
        let o = otros.clone();
        w.start(q.clone(), stamp(&q), move |_| {
            o.fetch_add(1, Ordering::SeqCst);
        });
        assert_eq!(w.path().as_deref(), Some(q.as_path()));
        fs::write(&p, b"el primero ya no se vigila").unwrap();
        settle();
        assert_eq!(hits.load(Ordering::SeqCst), 0);

        w.stop();
        assert_eq!(w.path(), None);
        fs::write(&q, b"el segundo tampoco, ya se paro").unwrap();
        settle();
        assert_eq!(otros.load(Ordering::SeqCst), 0);
        // Las ordenes sin vigilancia son inocuas
        w.pause();
        w.resume(true);
        w.set_baseline(None);
    }
}
