import type { TFunction } from "i18next";
import type { Flag, FlagSeverity } from "../api/types";

/** Que tipo de entidad del juego es el `subject` de cada regla (para mostrar su nombre). */
const SUBJECT_KIND: Record<string, "move" | "item" | "ability" | "stat" | "nature"> = {
  moves_duplicate: "move", move_unknown: "move", move_not_learnable: "move", pp_over_total: "move", ppups_range: "move",
  item_unknown: "item", ball_unknown: "item", ball_not_pokeball: "item", bag_item_unknown: "item", bag_wrong_pocket: "item",
  bag_duplicate_item: "item", bag_qty_range: "item", key_item_multiple: "item",
  ability_not_allowed: "ability", ability_index_mismatch: "ability",
  iv_range: "stat", ev_range: "stat", nature_invalid: "nature",
};

export interface NameLookup {
  move: (id: string) => string | undefined;
  item: (id: string) => string | undefined;
  ability: (id: string) => string | undefined;
}

function tr(t: TFunction, key: string, opts?: Record<string, unknown>): string {
  return t(key as never, (opts ?? {}) as never) as unknown as string;
}

/** Texto traducido de una flag, con los nombres del juego cuando se conocen. */
export function flagText(t: TFunction, flag: Flag, names?: NameLookup): string {
  const kind = SUBJECT_KIND[flag.code];
  const subject = flag.subject ?? "";
  let shown = subject;
  if (kind === "move") shown = names?.move(subject) ?? subject;
  else if (kind === "item") shown = names?.item(subject) ?? subject;
  else if (kind === "ability") shown = names?.ability(subject) ?? subject;
  else if (kind === "stat") shown = tr(t, `stat.${subject}`);
  else if (kind === "nature") shown = subject === "nature_for_stats" ? tr(t, "legality.natureForStats") : tr(t, "pokemon.nature");
  const params = { ...flag.params } as Record<string, unknown>;
  if (Array.isArray(params.stats)) params.stats = (params.stats as string[]).map((s) => tr(t, `stat.${s}`)).join(", ");
  const key = `legality.flag.${flag.code}`;
  return tr(t, key, { ...params, subject: shown, stat: shown, defaultValue: flag.code });
}

const ORDER: Record<FlagSeverity, number> = { illegal: 0, warning: 1, info: 2 };

export function worstSeverity(flags: Flag[] | undefined): FlagSeverity | null {
  if (!flags || flags.length === 0) return null;
  return flags.reduce<FlagSeverity>((w, f) => (ORDER[f.severity] < ORDER[w] ? f.severity : w), "info");
}

export function sortFlags(flags: Flag[]): Flag[] {
  return [...flags].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.code.localeCompare(b.code));
}
