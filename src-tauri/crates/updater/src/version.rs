//! Versiones semanticas (`1.2.0`, `v1.3.0-beta.2`): lo justo para decidir si un Release es mas nuevo que el instalado.

use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Ident {
    Num(u64),
    Alpha(String),
}

impl Ord for Ident {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (Ident::Num(a), Ident::Num(b)) => a.cmp(b),
            (Ident::Num(_), Ident::Alpha(_)) => Ordering::Less, // los numericos van antes que los alfanumericos
            (Ident::Alpha(_), Ident::Num(_)) => Ordering::Greater,
            (Ident::Alpha(a), Ident::Alpha(b)) => a.cmp(b),
        }
    }
}
impl PartialOrd for Ident {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pre: Vec<Ident>,
}

impl Version {
    /// `1.2.0`, `v1.2.0`, `1.2.0-beta.1`, `1.2.0+build` (lo de `+` se ignora). Cualquier otra cosa: `None`.
    pub fn parse(text: &str) -> Option<Version> {
        let t = text.trim();
        let t = t.strip_prefix(['v', 'V']).unwrap_or(t);
        let t = t.split('+').next()?;
        let (core, pre) = match t.split_once('-') {
            Some((c, p)) => (c, Some(p)),
            None => (t, None),
        };
        let mut nums = core.split('.');
        let major = number(nums.next()?)?;
        let minor = number(nums.next()?)?;
        let patch = number(nums.next()?)?;
        if nums.next().is_some() {
            return None;
        }
        let pre = match pre {
            None => Vec::new(),
            Some(p) if p.is_empty() => return None,
            Some(p) => p
                .split('.')
                .map(|id| {
                    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
                        None
                    } else if id.bytes().all(|b| b.is_ascii_digit()) {
                        id.parse().ok().map(Ident::Num)
                    } else {
                        Some(Ident::Alpha(id.to_string()))
                    }
                })
                .collect::<Option<Vec<_>>>()?,
        };
        Some(Version { major, minor, patch, pre })
    }

    pub fn is_prerelease(&self) -> bool {
        !self.pre.is_empty()
    }
}

fn number(s: &str) -> Option<u64> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater, // 1.2.0 > 1.2.0-rc.1
                (false, true) => Ordering::Less,
                (false, false) => self.pre.cmp(&other.pre), // Vec compara elemento a elemento y, si es prefijo, el mas corto es menor
            })
    }
}
impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)?;
        if !self.pre.is_empty() {
            let ids: Vec<String> = self
                .pre
                .iter()
                .map(|i| match i {
                    Ident::Num(n) => n.to_string(),
                    Ident::Alpha(a) => a.clone(),
                })
                .collect();
            write!(f, "-{}", ids.join("."))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap_or_else(|| panic!("no parsea {s}"))
    }

    #[test]
    fn parsea_con_y_sin_v_y_con_build() {
        assert_eq!(v("1.2.0"), v("v1.2.0"));
        assert_eq!(v("1.2.0+abc"), v("1.2.0"));
        assert_eq!(v("1.2.0").to_string(), "1.2.0");
        assert_eq!(v("v1.3.0-beta.2").to_string(), "1.3.0-beta.2");
    }

    #[test]
    fn rechaza_lo_que_no_es_semver() {
        for bad in ["", "1", "1.2", "1.2.x", "1.2.3.4", "a.b.c", "1.2.3-", "1.2.3-a..b", "1.2.-3", "01x.2.3"] {
            assert!(Version::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn orden_numerico_no_lexico() {
        assert!(v("1.10.0") > v("1.9.9"));
        assert!(v("1.2.10") > v("1.2.9"));
        assert!(v("2.0.0") > v("1.99.99"));
    }

    #[test]
    fn la_prerelease_va_antes_que_la_final() {
        assert!(v("1.2.0") > v("1.2.0-rc.1"));
        assert!(v("1.2.0-rc.2") > v("1.2.0-rc.1"));
        assert!(v("1.2.0-rc.10") > v("1.2.0-rc.9"));
        assert!(v("1.2.0-rc") > v("1.2.0-beta"));
        assert!(v("1.2.0-rc.1") > v("1.2.0-rc"));
        assert!(v("1.2.0-1") < v("1.2.0-alpha"));
        assert!(v("1.1.0") < v("1.2.0-rc.1"));
        assert!(v("1.2.0-rc.1").is_prerelease() && !v("1.2.0").is_prerelease());
    }
}
