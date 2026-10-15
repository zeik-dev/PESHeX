// Formateadores de numeros, dinero, duraciones y fechas (respetan el idioma).

export function formatNumber(n: number | null | undefined, locale: string): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(locale).format(n);
}

/** Dinero del juego con el simbolo de Pokédólar. */
export function formatMoney(n: number | null | undefined, locale: string): string {
  if (n == null) return "—";
  return `₽${formatNumber(n, locale)}`;
}

/** Duracion corta: "10 h 52 min", "52 min", "40 s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${total} s`;
}

/** Tamaño de archivo legible: "17,5 MB", "820 KB". */
export function formatBytes(bytes: number | null | undefined, locale: string): string {
  if (bytes == null || Number.isNaN(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)} ${units[i]}`;
}

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function formatTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(d);
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** Matiz estable (0-359) a partir de un texto, para placeholders de sprite. */
export function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
