// Tipos de la carpeta del juego vinculada (espejo de driver/semantic/gamedata/*
// y de src-tauri/src/game.rs).

export type GameSource = "auto" | "manual" | "remembered";
export type LegalityLevel = "full" | "partial" | "basic";
export type CalStatus = "ok" | "mismatch" | "unknown";

export interface DomainInfo {
  count: number;
  source: "dat" | "pbs" | "none";
  error: string | null;
}

export interface Calibration {
  species: CalDomain;
  stats: CalDomain;
  exp: CalDomain;
  moves: CalDomain;
  abilities: CalDomain;
  error?: string;
}

export interface CalDomain {
  status: CalStatus;
  checked: number;
  matched: number;
  ratio: number | null;
}

export interface GameStatus {
  linked: boolean;
  root?: string;
  source?: GameSource;
  title?: string | null;
  folder?: { hasData: boolean; hasGraphics: boolean; hasPbs: boolean; encrypted: boolean };
  data?: {
    state: "ready" | "partial" | "error";
    version: string | null;
    domains: Record<"species" | "moves" | "items" | "abilities" | "types", DomainInfo>;
    errors: string[];
  };
  limits?: Record<string, number>;
  limitSources?: Record<string, string>;
  settingsFiles?: number;
  calibration?: Calibration | null;
  legality: { level: LegalityLevel; reasons: string[] };
}

// ── Catalogo (selectores) ───────────────────────────────────────────────────

export interface CatSpecies {
  id: string;
  species: string;
  form: number;
  name: string | null;
  formName: string | null;
  types: string[];
  /** Numero de especie en las bases <= v18 (id entero del save); null en v19+. */
  number: number | null;
  /** Posicion en el listado nacional (el PBS de v19+ no numera las especies). */
  order?: number | null;
}
export interface CatMove {
  id: string;
  /** Numero de movimiento en las bases <= v18. */
  number?: number | null;
  name: string | null;
  type: string | null;
  category: number | null;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
}
export interface CatItem {
  id: string;
  number?: number | null;
  name: string | null;
  pocket: number | null;
  machine: boolean;
  move: string | null;
  fieldUse: number | null;
}
export interface CatAbility {
  id: string;
  number?: number | null;
  name: string | null;
  description: string | null;
}
export interface CatType {
  id: string;
  name: string | null;
  weaknesses?: string[];
  resistances?: string[];
  immunities?: string[];
  special?: boolean;
}
export interface CatRibbon {
  id: string;
  name: string | null;
  description: string | null;
  icon: number | null;
}
export interface CatNature {
  id: string;
  up: string | null;
  down: string | null;
}

export interface Catalog {
  species: CatSpecies[];
  moves: CatMove[];
  items: CatItem[];
  abilities: CatAbility[];
  types: CatType[];
  natures: CatNature[];
  ribbons?: CatRibbon[];
}

/** Datos de Pokédex de una especie (PBS / `.dat`); todo es opcional según el juego. */
export interface SpeciesInfo {
  category?: string;
  pokedex?: string;
  /** m y kg. */
  height?: number;
  weight?: number;
  color?: string;
  shape?: string;
  habitat?: string;
  generation?: number;
  catchRate?: number;
  happiness?: number;
  evYield?: Record<string, number>;
  eggGroups?: string[];
  hatchSteps?: number;
  baseExp?: number;
  wildItems?: { common?: string[]; uncommon?: string[]; rare?: string[] };
  formNames?: string[];
}

export interface SpeciesMega {
  stone: string | null;
  move: string | null;
  message: number | null;
  unmega: number | null;
}

export interface SpeciesForm {
  id: string;
  form: number;
  formName: string | null;
  types: string[];
  baseStats: Record<string, number>;
  mega: SpeciesMega | null;
  region: string | null;
}

export interface SpeciesEvolution {
  species: string;
  method: string;
  param: string | number | null;
  prevo: boolean;
}

export interface SpeciesDetail {
  id: string;
  species: string;
  form: number;
  number?: number | null;
  order?: number | null;
  name: string | null;
  formName: string | null;
  types: string[];
  baseStats: Record<string, number>;
  growthRate: string;
  genderRatio: string | null;
  abilities: string[];
  hiddenAbilities: string[];
  /** [nivel, movimiento]; nivel 0 = al evolucionar, -1 = solo con recordador en algunas bases. */
  levelMoves: [number, string][];
  tutorMoves: string[];
  eggMoves: string[];
  /** Movimientos de MT (tm.txt de v16-18). */
  tmMoves?: string[];
  /** Todo lo que la especie (y sus preevoluciones) puede aprender a cualquier nivel: nivel, tutor, MT y huevo. */
  learnable?: string[];
  evolutions: SpeciesEvolution[];
  prevos: string[];
  minimumLevel: number;
  info?: SpeciesInfo;
  mega?: SpeciesMega | null;
  region?: string | null;
  forms?: SpeciesForm[];
  /** Bloques opcionales que no se pudieron leer (la ficha llega igual, sin ellos). */
  warnings?: string[];
}

/** Dónde aparece una especie (encounters.txt) y su número en las Pokédex regionales. */
export interface SpeciesExtras {
  id: string;
  encounters: { map: number; name: string | null; method: string; min: number | null; max: number | null; chance: number | null }[];
  regional: Record<string, number>;
  warnings?: string[];
}

// ── Escaneo de Graphics/ (src-tauri/src/game.rs) ────────────────────────────

/** [ruta relativa a la raiz con '/', ancho, alto] */
export type ScanFile = [string, number, number];

export interface GameScan {
  root: string;
  graphics: string | null;
  files: ScanFile[];
  truncated: boolean;
}
