// Logica pura de la paleta: filtrado de comandos y destino de cada resultado de busqueda.

import type { SearchHit, SearchResult, WorldKind } from "../../api/types";
import { norm } from "../../game/normalize";
import type { ViewId } from "../../stores/session";

export interface PaletteCmd {
  id: string;
  label: string;
  /** Texto extra por el que tambien se encuentra (sinonimos). */
  keywords?: string;
  group: "view" | "action";
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

/** Comandos cuyo texto contiene la consulta (sin acentos ni mayusculas); los que empiezan por ella van primero. */
export function filterCommands(cmds: PaletteCmd[], query: string): PaletteCmd[] {
  const q = norm(query);
  if (!q) return cmds;
  const scored = cmds
    .map((c) => {
      const label = norm(c.label);
      const hay = `${label}${norm(c.keywords ?? "")}`;
      return { c, score: label.startsWith(q) ? 0 : label.includes(q) ? 1 : hay.includes(q) ? 2 : 9 };
    })
    .filter((x) => x.score < 9);
  scored.sort((a, b) => a.score - b.score);
  return scored.map((x) => x.c);
}

export type HitGroup = keyof SearchResult["groups"];

export interface HitTarget {
  view: ViewId;
  /** Pokemon a seleccionar en el PC/Equipo. */
  select?: string;
  /** Caja que se debe mostrar. */
  box?: number;
  /** Pestana y texto al abrir "Mundo". */
  world?: { kind: WorldKind; q: string };
}

/** A donde lleva un resultado de la busqueda global. */
export function hitTarget(group: HitGroup, hit: SearchHit): HitTarget | null {
  switch (group) {
    case "pokemon": {
      if (!hit.ref) return null;
      const [kind, box] = hit.ref.split("/");
      return kind === "party" ? { view: "party", select: hit.ref } : { view: "boxes", select: hit.ref, box: Number(box) };
    }
    case "items":
      return { view: "bag" };
    case "boxes":
      return hit.index == null ? null : { view: "boxes", box: hit.index };
    case "world":
      return hit.kind ? { view: "world", world: { kind: hit.kind, q: String(hit.id ?? hit.label) } } : null;
  }
}

export const HIT_GROUPS: HitGroup[] = ["pokemon", "items", "boxes", "world"];
