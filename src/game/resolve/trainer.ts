import { pad3 } from "../normalize";
import { firstHit, type Resolved, type ResolveCtx, resolved } from "./common";

/** Con qué imagen se dibuja al entrenador (lo que el driver lee del save y de PBS/metadata.txt). */
export interface TrainerKey {
  /** Nombre interno de la clase de entrenador ("POKEMONTRAINER_RojoNeutro"). */
  internal?: string | null;
  /** Numero de la clase en las bases <= v18 (`trainer004.png`). */
  number?: number | null;
  /** Atuendo (`@outfit`): el archivo puede llevar el sufijo `_<atuendo>`. */
  outfit?: number | null;
}

/** Donde puede estar la imagen: v19+ en `Graphics/Trainers`; v16-18 la guardan en `Graphics/Characters`. */
const DIRS = ["graphics/trainers", "graphics/characters"];

/** Nombres candidatos, del mas al menos especifico. Replica `pbPlayerSpriteFile` / `pbTrainerSpriteFile` de Essentials v16-18
 *  (`trainer<NOMBRE>[_<atuendo>]`, luego `trainer%03d[_<atuendo>]`) y los nombres por clase de v19+ (`<NOMBRE>[_<atuendo>]`). */
export function trainerNameCandidates(k: TrainerKey): string[] {
  const names: string[] = [];
  const add = (n: string) => {
    const lower = n.toLowerCase();
    if (!names.includes(lower)) names.push(lower);
  };
  const bases: string[] = [];
  if (k.internal) bases.push(`trainer${k.internal}`, k.internal);
  if (k.number != null && k.number >= 0) bases.push(`trainer${pad3(k.number)}`);
  for (const b of bases) {
    if (k.outfit != null && k.outfit >= 0) add(`${b}_${k.outfit}`);
    add(b);
  }
  return names;
}

/** Imagen del entrenador en la carpeta del juego, o null si no hay (el llamador pinta el marcador). */
export function resolveTrainerImage(ctx: ResolveCtx, k: TrainerKey): Resolved | null {
  const names = trainerNameCandidates(k);
  if (names.length === 0) return null;
  const hit = firstHit(ctx.index, DIRS, names);
  return hit ? resolved(hit.entry, hit.nameIndex === 0 ? "exact" : "fallback") : null;
}

/** Hoja de medallas: cuadrícula de celdas de 32×32 (Essentials: 8 por fila; la fila es la región). */
export interface BadgeSheet extends Resolved {
  cell: number;
  cols: number;
  rows: number;
}

const BADGE_DIRS = [
  "graphics/pictures",
  "graphics/ui",
  "graphics/ui/trainer card",
  "graphics/pictures/trainer card",
  "graphics/ui/trainercard",
  "graphics/pictures/trainercard",
];
const CELL = 32;

/** `badges.png` / `icon_badges.png` de la carpeta del juego, o null si no la hay o no es una cuadrícula de 32 px
 *  (Z: `Pictures/badges.png`, 256×64 = 8 columnas × 2 filas). */
export function resolveBadgeSheet(ctx: ResolveCtx): BadgeSheet | null {
  const hit = firstHit(ctx.index, BADGE_DIRS, ["badges", "icon_badges", "trainer_card_badges"]);
  if (!hit) return null;
  const { w, h } = hit.entry;
  if (w < CELL || h < CELL || w % CELL !== 0 || h % CELL !== 0) return null;
  return { ...resolved(hit.entry, "exact"), cell: CELL, cols: w / CELL, rows: h / CELL };
}
