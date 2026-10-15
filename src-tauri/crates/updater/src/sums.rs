//! Huellas SHA-256: calculo, y lectura de `SHA256SUMS.txt` / `CONTENIDO.sha256` (`<hash> *<nombre>` o `<hash>  <nombre>`).

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

pub fn sha256_bytes(data: &[u8]) -> String {
    hex(&Sha256::digest(data))
}

pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
}

/// `(huella en minusculas, nombre)` de cada linea valida; ignora lineas vacias o mal formadas.
pub fn parse(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim_end_matches(['\r', '\n']);
            let (hash, rest) = line.split_at_checked(64)?;
            if !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            // Tras la huella: un espacio y luego `*` (binario) o otro espacio (texto).
            let rest = rest.strip_prefix(' ')?;
            let name = rest.strip_prefix(['*', ' ']).unwrap_or(rest);
            if name.is_empty() {
                return None;
            }
            Some((hash.to_ascii_lowercase(), name.to_string()))
        })
        .collect()
}

/// La huella que `text` declara para el archivo `name`.
pub fn find(text: &str, name: &str) -> Option<String> {
    parse(text).into_iter().find(|(_, n)| n == name).map(|(h, _)| h)
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    #[test]
    fn hash_de_vacio_conocido() {
        assert_eq!(sha256_bytes(b""), H);
    }

    #[test]
    fn lee_los_dos_formatos_y_nombres_con_espacios() {
        let text = format!("{H} *PESHeX-1.2.0-windows-x64.zip\r\n{} ruby/lib/mi archivo.rb\n\nbasura\n{H}  otro.txt\n", H.to_uppercase());
        let p = parse(&text);
        assert_eq!(p.len(), 3);
        assert_eq!(p[0], (H.to_string(), "PESHeX-1.2.0-windows-x64.zip".to_string()));
        assert_eq!(p[1].1, "ruby/lib/mi archivo.rb");
        assert_eq!(p[1].0, H); // huella normalizada a minusculas
        assert_eq!(p[2].1, "otro.txt");
        assert_eq!(find(&text, "otro.txt").as_deref(), Some(H));
        assert!(find(&text, "no-esta.zip").is_none());
    }

    #[test]
    fn ignora_huellas_truncadas_o_no_hexadecimales() {
        assert!(parse(&format!("{} *a.zip\n", &H[..63])).is_empty());
        assert!(parse(&format!("{}zz *a.zip\n", &H[..62])).is_empty());
        assert!(parse(&format!("{H}*a.zip\n")).is_empty()); // sin el espacio separador
    }
}
