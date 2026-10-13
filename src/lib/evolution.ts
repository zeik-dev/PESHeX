/** Qué clase de dato es el parámetro de un método de evolución de Essentials (nivel, objeto, movimiento, tipo, especie…). */
export type EvoParamKind = "number" | "item" | "move" | "type" | "species" | "raw" | "none";

const NUMBER = /^(Level|AttackGreater|AtkDefEqual|DefenseGreater|Silcoon|Cascoon|Ninjask|Shedinja|Beauty|Happiness$)/;

export function evoParamKind(method: string, param: string | number | null | undefined): EvoParamKind {
  if (param == null || param === "") return "none";
  if (/^(HasMoveType|HappinessMoveType)$/.test(method)) return "type";
  if (/^(HasMove|HappinessMove)$/.test(method)) return "move";
  if (/^(HasInParty|TradeSpecies)$/.test(method)) return "species";
  if (/Item/.test(method)) return "item";
  if (NUMBER.test(method) || typeof param === "number") return "number";
  return "raw";
}

/** «HappinessDay» → «Happiness day» (texto de respaldo cuando el método no tiene traducción). */
export function humanizeMethod(method: string): string {
  const words = method.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Agrupa encuentros por mapa para mostrarlos juntos: {map, name} → filas (método, niveles, probabilidad). */
export interface EncounterRow {
  map: number;
  name: string | null;
  method: string;
  min: number | null;
  max: number | null;
  chance: number | null;
}

export interface EncounterGroup {
  map: number;
  name: string | null;
  rows: EncounterRow[];
}

export function groupEncounters(list: readonly EncounterRow[]): EncounterGroup[] {
  const groups = new Map<number, EncounterGroup>();
  for (const r of list) {
    let g = groups.get(r.map);
    if (!g) groups.set(r.map, (g = { map: r.map, name: r.name, rows: [] }));
    if (!g.name && r.name) g.name = r.name;
    g.rows.push(r);
  }
  return [...groups.values()].sort((a, b) => (a.name ?? "￿").localeCompare(b.name ?? "￿") || a.map - b.map);
}

/** «Nv. 2–4» / «Nv. 5». */
export function levelRange(min: number | null, max: number | null): string | null {
  if (min == null) return null;
  return max == null || max === min ? String(min) : `${min}–${max}`;
}
