import type { AssetIndex } from "./assetIndex";

/** Carpetas de assets de este juego (en minusculas, con '/'). Cada version de
 *  Essentials las puso en un sitio distinto; aqui se detecta cual existe. */
export interface Layout {
  /** modern = v20/v21 (Graphics/Pokemon/Icons...), v19, legacy = v16-v18 (Graphics/Icons/icon001), unknown */
  family: "modern" | "legacy" | "unknown";
  pokemonIcons: string | null;
  pokemonIconsShiny: string | null;
  eggs: string | null;
  items: string | null;
  /** Carpetas donde puede estar icon_ball_<ID> / icon_item (en orden de preferencia). */
  summary: string[];
  party: string[];
  /** Carpetas donde pueden estar los fondos de caja box_<N> (en orden de preferencia). */
  boxes: string[];
  /** Nombres numerados (icon001, item001): bases v16-v18. */
  numbered: boolean;
}

const first = (index: AssetIndex, dirs: string[]): string | null => dirs.find((d) => index.hasDir(d)) ?? null;
const all = (index: AssetIndex, dirs: string[]): string[] => dirs.filter((d) => index.hasDir(d));

export function detectLayout(index: AssetIndex): Layout {
  const modernIcons = first(index, ["graphics/pokemon/icons"]);
  const legacyIcons = index.list("graphics/icons").filter((e) => /^icon\d{3}/.test(e.name)).length > 0;
  const items = first(index, ["graphics/items"]) ?? (legacyIcons ? "graphics/icons" : null);
  return {
    family: modernIcons ? "modern" : legacyIcons ? "legacy" : "unknown",
    pokemonIcons: modernIcons ?? (legacyIcons ? "graphics/icons" : null),
    pokemonIconsShiny: first(index, ["graphics/pokemon/icons shiny"]),
    eggs: first(index, ["graphics/pokemon/eggs"]),
    items,
    summary: all(index, ["graphics/ui/summary", "graphics/pictures/summary"]),
    party: all(index, ["graphics/ui/party", "graphics/pictures/party"]),
    boxes: all(index, ["graphics/ui/storage", "graphics/pictures/storage", "graphics/pictures"]),
    numbered: !modernIcons && legacyIcons,
  };
}
