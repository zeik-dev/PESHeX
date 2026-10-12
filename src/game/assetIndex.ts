import { stripExt } from "./normalize";
import type { ScanFile } from "./types";

export interface AssetEntry {
  /** Ruta relativa a la raiz del juego, como la devolvio el escaneo. */
  path: string;
  /** Carpeta en minusculas con '/' (p. ej. "graphics/pokemon/icons"). */
  dir: string;
  /** Nombre sin extension, en minusculas. */
  name: string;
  w: number;
  h: number;
}

/** Indice (sin distinguir mayusculas) de las imagenes de Graphics/ del juego. */
export class AssetIndex {
  private readonly entries: AssetEntry[] = [];
  private readonly byKey = new Map<string, AssetEntry>();
  private readonly byDir = new Map<string, AssetEntry[]>();
  private readonly byPathLower = new Map<string, AssetEntry>();

  constructor(files: ScanFile[]) {
    for (const [path, w, h] of files) {
      const slash = path.lastIndexOf("/");
      const dir = (slash >= 0 ? path.slice(0, slash) : "").toLowerCase();
      const name = stripExt(slash >= 0 ? path.slice(slash + 1) : path).toLowerCase();
      const entry: AssetEntry = { path, dir, name, w, h };
      this.entries.push(entry);
      // Si hay dos archivos con el mismo nombre y distinta extension, gana el primero (png antes que bmp por orden).
      const key = `${dir}/${name}`;
      if (!this.byKey.has(key)) this.byKey.set(key, entry);
      this.byPathLower.set(path.toLowerCase(), entry);
      let list = this.byDir.get(dir);
      if (!list) this.byDir.set(dir, (list = []));
      list.push(entry);
    }
  }

  get size(): number {
    return this.entries.length;
  }

  all(): AssetEntry[] {
    return this.entries;
  }

  /** `get("graphics/pokemon/icons", "bulbasaur")` */
  get(dir: string, name: string): AssetEntry | undefined {
    return this.byKey.get(`${dir.toLowerCase()}/${name.toLowerCase()}`);
  }

  byPath(path: string): AssetEntry | undefined {
    return this.byPathLower.get(path.toLowerCase());
  }

  list(dir: string): AssetEntry[] {
    return this.byDir.get(dir.toLowerCase()) ?? [];
  }

  hasDir(dir: string): boolean {
    return this.byDir.has(dir.toLowerCase());
  }

  dirs(): string[] {
    return [...this.byDir.keys()];
  }
}
