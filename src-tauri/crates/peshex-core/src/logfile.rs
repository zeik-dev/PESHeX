//! Registro de diagnostico en un archivo de texto (`updater.log`): una linea por suceso, con fecha UTC, nivel y origen.
//! Sirve para saber QUE paso cuando algo falla en un equipo que no es el nuestro (p. ej. una actualizacion que no termino).
//!
//! Escribir en el registro **nunca** falla ni interrumpe nada: cualquier error de disco se ignora. El archivo se recorta
//! solo (se queda con las ultimas lineas) cuando supera [`MAX_BYTES`], asi que no crece sin limite.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Tamano a partir del cual se recorta el registro...
pub const MAX_BYTES: u64 = 256 * 1024;
/// ...dejando aproximadamente esto (las lineas mas recientes).
pub const KEEP_BYTES: u64 = 128 * 1024;

/// Dia civil (año, mes, dia) de un numero de dias desde 1970-01-01 (algoritmo de Howard Hinnant, calendario gregoriano).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

/// `AAAA-MM-DDThh:mm:ssZ` (UTC) de unos segundos desde 1970.
pub fn timestamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Deja solo las lineas finales (hasta ~`KEEP_BYTES`) si el archivo pasa de `MAX_BYTES`.
fn trim(path: &Path) {
    let Ok(meta) = fs::metadata(path) else { return };
    if meta.len() <= MAX_BYTES {
        return;
    }
    let Ok(bytes) = fs::read(path) else { return };
    let from = bytes.len().saturating_sub(KEEP_BYTES as usize);
    // Empieza en una linea completa: salta hasta el siguiente salto de linea.
    let start = bytes[from..].iter().position(|b| *b == b'\n').map_or(from, |i| from + i + 1);
    let _ = fs::write(path, &bytes[start..]);
}

/// Anade una linea `fecha nivel origen mensaje`. El mensaje se aplana a una sola linea. Nunca falla.
pub fn append_at(path: &Path, secs: u64, level: &str, msg: &str) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    trim(path);
    let flat = msg.replace(['\r', '\n'], " ");
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{} {:<5} {}", timestamp(secs), level, flat);
    }
}

/// Como [`append_at`] con la hora actual.
pub fn append(path: &Path, level: &str, msg: &str) {
    append_at(path, now_secs(), level, msg);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Tmp;

    #[test]
    fn fechas_utc_conocidas() {
        assert_eq!(timestamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(timestamp(1_000_000_000), "2001-09-09T01:46:40Z");
        assert_eq!(timestamp(951_782_400), "2000-02-29T00:00:00Z"); // año bisiesto divisible por 400
        assert_eq!(timestamp(1_784_121_659), "2026-07-15T13:20:59Z");
        assert_eq!(timestamp(4_102_444_799), "2099-12-31T23:59:59Z");
    }

    #[test]
    fn escribe_lineas_con_fecha_nivel_y_mensaje_en_una_sola_linea() {
        let t = Tmp::new("log");
        let p = t.path().join("sub").join("updater.log"); // la carpeta no existe: se crea
        append_at(&p, 0, "INFO", "[app] hola\ny adios\r\n");
        append_at(&p, 61, "ERROR", "[updater] fallo");
        let text = fs::read_to_string(&p).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 2, "{text}");
        assert_eq!(lines[0], "1970-01-01T00:00:00Z INFO  [app] hola y adios  ");
        assert_eq!(lines[1], "1970-01-01T00:01:01Z ERROR [updater] fallo");
    }

    #[test]
    fn se_recorta_solo_conservando_lo_mas_reciente_y_lineas_enteras() {
        let t = Tmp::new("logtrim");
        let p = t.path().join("updater.log");
        let line = "x".repeat(99); // 99 + fecha/nivel/salto ~ 130 bytes por linea
        for i in 0..3000 {
            append_at(&p, i, "INFO", &format!("{i:05} {line}"));
        }
        let size = fs::metadata(&p).unwrap().len();
        assert!(size <= MAX_BYTES + 200, "el archivo no crece sin limite: {size}");
        let text = fs::read_to_string(&p).unwrap();
        assert!(text.lines().all(|l| l.len() > 100 && l.starts_with("1970-")), "todas las lineas quedan enteras");
        assert!(text.contains("02999"), "lo mas reciente se conserva");
        assert!(!text.contains(" 00000 "), "lo mas antiguo se descarta");
    }

    #[test]
    fn nunca_falla_aunque_no_se_pueda_escribir() {
        let t = Tmp::new("lognofail");
        // La «ruta» del registro es una carpeta existente: abrirla para escribir falla, y no pasa nada.
        append(t.path(), "INFO", "esto no se puede escribir");
        // Ni una ruta imposible
        append(Path::new(""), "INFO", "tampoco");
    }
}
