// Hash perceptual (dHash) para SUGERIR a que Pokémon pertenece una imagen de la
// carpeta del juego cuyo nombre no sigue la convencion. Se compara solo contra
// assets ya identificados DEL MISMO juego (no hay modelo ni datos oficiales
// incluidos) y NUNCA se aplica solo: el usuario confirma cada sugerencia.

export interface Rgba {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

const ALPHA_THRESHOLD = 128;
const BACKDROP = 128; // gris sobre el que se compone la transparencia

/** Los iconos de equipo son tiras horizontales de cuadros: se usa solo el primero. */
export function firstFrame(img: Rgba): Rgba {
  const { width: w, height: h } = img;
  if (h <= 0 || w < h * 1.5) return img;
  const frames = Math.max(1, Math.round(w / h));
  const fw = Math.floor(w / frames);
  const data: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < fw; x++) {
      const i = (y * w + x) * 4;
      data.push(img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]);
    }
  }
  return { data, width: fw, height: h };
}

function luminanceAt(img: Rgba, x: number, y: number): number {
  const i = (y * img.width + x) * 4;
  const a = img.data[i + 3] / 255;
  const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  return lum * a + BACKDROP * (1 - a);
}

/** Reduccion por promedio de area a una rejilla gw x gh de luminancias. */
export function luminanceGrid(img: Rgba, gw: number, gh: number): number[] {
  const out: number[] = [];
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * img.height) / gh);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * img.height) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * img.width) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * img.width) / gw));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < img.height; y++) {
        for (let x = x0; x < x1 && x < img.width; x++) {
          sum += luminanceAt(img, x, y);
          n++;
        }
      }
      out.push(n ? sum / n : BACKDROP);
    }
  }
  return out;
}

/** dHash de 64 bits: compara cada pixel con el de su derecha en una rejilla 9x8. */
export function dhash(img: Rgba): bigint {
  const g = luminanceGrid(firstFrame(img), 9, 8);
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (g[y * 9 + x] > g[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits;
}

/** Mascara 8x8 de la silueta (donde hay pixeles opacos): ayuda a distinguir
 *  sprites de formas muy distintas que tengan un dHash parecido. */
export function silhouette(img: Rgba): bigint {
  const f = firstFrame(img);
  let bits = 0n;
  for (let gy = 0; gy < 8; gy++) {
    const y0 = Math.floor((gy * f.height) / 8);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * f.height) / 8));
    for (let gx = 0; gx < 8; gx++) {
      const x0 = Math.floor((gx * f.width) / 8);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * f.width) / 8));
      let opaque = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < f.height; y++) {
        for (let x = x0; x < x1 && x < f.width; x++) {
          if (f.data[(y * f.width + x) * 4 + 3] >= ALPHA_THRESHOLD) opaque++;
          n++;
        }
      }
      bits = (bits << 1n) | (n && opaque * 2 >= n ? 1n : 0n);
    }
  }
  return bits;
}

export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export interface HashEntry {
  path: string;
  dhash: bigint;
  sil: bigint;
}
export interface Suggestion {
  label: string;
  path: string;
  /** Distancia total (dHash + silueta): menor = mas parecido. */
  distance: number;
}

export const MAX_DHASH_DISTANCE = 12;
export const MAX_SIL_DISTANCE = 10;

export function hashImage(img: Rgba): { dhash: bigint; sil: bigint } {
  return { dhash: dhash(img), sil: silhouette(img) };
}

/** Los `limit` assets etiquetados mas parecidos a `target`, dentro de los umbrales. */
export function nearest(
  target: { dhash: bigint; sil: bigint },
  labeled: (HashEntry & { label: string })[],
  limit = 3,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const l of labeled) {
    const dd = hamming(target.dhash, l.dhash);
    const sd = hamming(target.sil, l.sil);
    if (dd <= MAX_DHASH_DISTANCE && sd <= MAX_SIL_DISTANCE) out.push({ label: l.label, path: l.path, distance: dd + sd });
  }
  return out.sort((a, b) => a.distance - b.distance).slice(0, limit);
}

/** Decodifica bytes de imagen a RGBA (solo navegador/WebView). */
export async function decodeRgba(bytes: Uint8Array, mime = "image/png"): Promise<Rgba> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas no disponible");
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  bmp.close();
  return { data: d.data, width: d.width, height: d.height };
}
