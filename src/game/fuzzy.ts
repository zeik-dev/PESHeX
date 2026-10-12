import { norm } from "./normalize";

/** Distancia de Damerau-Levenshtein (variante "optimal string alignment"). */
export function damerau(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const d: number[][] = Array.from({ length: la + 1 }, () => new Array<number>(lb + 1).fill(0));
  for (let i = 0; i <= la; i++) d[i][0] = i;
  for (let j = 0; j <= lb; j++) d[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[la][lb];
}

/** Similitud 0..1 (1 = identicos). */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - damerau(a, b) / max;
}

/** El unico candidato claramente mas parecido a `query` (similitud >= `min`) o
 *  null. Si hay empate o el segundo queda a menos de `margin`, es ambiguo y NO
 *  se asigna nada (preferimos no mostrar un sprite a mostrar uno equivocado). */
export function uniqueBestMatch<T>(
  query: string,
  candidates: T[],
  key: (c: T) => string,
  min = 0.85,
  margin = 0.05,
): T | null {
  const q = norm(query);
  if (!q) return null;
  let best: T | null = null;
  let bestScore = -1;
  let second = -1;
  for (const c of candidates) {
    const s = similarity(q, norm(key(c)));
    if (s > bestScore) {
      second = bestScore;
      bestScore = s;
      best = c;
    } else if (s > second) {
      second = s;
    }
  }
  if (!best || bestScore < min) return null;
  if (second >= 0 && bestScore - second < margin) return null;
  return best;
}

/** Puntua cuanto encaja `query` con un texto (0 = no encaja). */
export function matchScore(query: string, text: string): number {
  const q = norm(query);
  const t = norm(text);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80 - Math.min(20, t.length - q.length) * 0.5;
  // Inicio de palabra del texto original ("Mime" en "Mr. Mime").
  const words = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().split(/[^A-Z0-9]+/);
  if (words.some((w) => w.startsWith(q))) return 70;
  if (t.includes(q)) return 60 - Math.min(15, t.indexOf(q)) * 0.5;
  if (q.length >= 3) {
    const s = similarity(q, t.slice(0, Math.max(q.length, 1) + 1));
    if (s >= 0.7) return 40 * s;
  }
  return 0;
}

/** Busqueda para los selectores: mejores `limit` elementos por `keys` (nombre, id...). */
export function rankSearch<T>(items: T[], query: string, keys: (item: T) => (string | null | undefined)[], limit = 50): T[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);
  const scored: { item: T; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    let best = 0;
    for (const k of keys(item)) if (k) best = Math.max(best, matchScore(q, k));
    if (best > 0) scored.push({ item, score: best, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.item);
}
