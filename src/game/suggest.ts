// Sugerencias por parecido (dHash) para los iconos huerfanos. Solo SUGIERE: la app nunca
// asigna un icono sin que el usuario lo confirme.

import { decodeRgba, hashImage, nearest, type HashEntry, type Suggestion } from "./dhash";
import type { AssetEntry } from "./assetIndex";
import type { MissingSpecies } from "./orphans";

export type ReadFile = (rel: string) => Promise<Uint8Array>;

function mimeOf(rel: string): string {
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "bmp" ? "image/bmp" : "image/png";
}

async function hashFile(read: ReadFile, rel: string) {
  return hashImage(await decodeRgba(await read(rel), mimeOf(rel)));
}

export interface SuggestOptions {
  /** Cuantos huerfanos y especies como maximo se procesan (decodificar es lo caro). */
  maxOrphans?: number;
  maxSpecies?: number;
  onProgress?: (done: number, total: number) => void;
  /** Cancelacion. */
  signal?: { cancelled: boolean };
}

/** `clave de especie -> sugerencias` (solo las que superan los umbrales de parecido). */
export async function suggestIcons(
  read: ReadFile,
  missing: { species: MissingSpecies; reference: AssetEntry }[],
  orphans: AssetEntry[],
  opts: SuggestOptions = {},
): Promise<Map<string, Suggestion[]>> {
  const out = new Map<string, Suggestion[]>();
  const orphanList = orphans.slice(0, opts.maxOrphans ?? 400);
  const speciesList = missing.slice(0, opts.maxSpecies ?? 60);
  const total = orphanList.length + speciesList.length;
  let done = 0;
  const tick = () => opts.onProgress?.(++done, total);

  const labeled: (HashEntry & { label: string })[] = [];
  for (const o of orphanList) {
    if (opts.signal?.cancelled) return out;
    try {
      labeled.push({ path: o.path, label: o.path, ...(await hashFile(read, o.path)) });
    } catch {
      /* imagen ilegible: se omite */
    }
    tick();
  }
  for (const m of speciesList) {
    if (opts.signal?.cancelled) return out;
    try {
      const sug = nearest(await hashFile(read, m.reference.path), labeled, 3);
      if (sug.length) out.set(m.species.key, sug);
    } catch {
      /* sin referencia legible */
    }
    tick();
  }
  return out;
}
