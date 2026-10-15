//! Utilidades de archivos compartidas por los modulos de `peshex-core`.

use std::fs;
use std::io;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

/// FNV-1a de 64 bits: un identificador corto y estable (no criptografico) para nombrar archivos de cache por ruta.
pub fn fnv1a64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Escribe `bytes` en `path` de forma atomica: primero a un temporal del mismo directorio y despues `rename`.
/// Un corte de luz o un cierre a mitad de escritura nunca deja el archivo a medias.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&tmp, bytes)?;
    match fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Serializa `value` como JSON legible y lo guarda de forma atomica.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let text = serde_json::to_vec_pretty(value).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    write_atomic(path, &text)
}

/// Lee un JSON; `None` si no existe o esta danado (un archivo de estado roto nunca debe impedir arrancar).
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::Tmp;

    #[test]
    fn fnv_es_estable_y_distingue_rutas() {
        assert_eq!(fnv1a64(""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a64("a"), 0xaf63_dc4c_8601_ec8c);
        assert_ne!(fnv1a64("c:\\juegos\\a"), fnv1a64("c:\\juegos\\b"));
    }

    #[test]
    fn la_escritura_atomica_no_deja_temporales_y_reemplaza() {
        let t = Tmp::new("atomic");
        let p = t.path().join("sub").join("estado.json");
        write_atomic(&p, b"uno").unwrap();
        write_atomic(&p, b"dos").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"dos");
        let names: Vec<_> = fs::read_dir(p.parent().unwrap()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1, "solo queda el archivo final: {names:?}");
    }

    #[test]
    fn un_json_danado_o_ausente_es_none() {
        let t = Tmp::new("json");
        let p = t.path().join("x.json");
        assert!(read_json::<Vec<u32>>(&p).is_none());
        fs::write(&p, b"{no es json").unwrap();
        assert!(read_json::<Vec<u32>>(&p).is_none());
        write_json(&p, &vec![1u32, 2, 3]).unwrap();
        assert_eq!(read_json::<Vec<u32>>(&p), Some(vec![1, 2, 3]));
    }
}
