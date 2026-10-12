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
  number: number | null;
}
export interface CatMove {
  id: string;
  name: string | null;
  type: string | null;
  category: number | null;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
}
export interface CatItem {
  id: string;
  name: string | null;
  pocket: number | null;
  machine: boolean;
  move: string | null;
  fieldUse: number | null;
}
export interface CatAbility {
  id: string;
  name: string | null;
  description: string | null;
}
export interface CatType {
  id: string;
  name: string | null;
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
}

export interface SpeciesDetail {
  id: string;
  species: string;
  form: number;
  name: string | null;
  formName: string | null;
  types: string[];
  baseStats: Record<string, number>;
  growthRate: string;
  genderRatio: string | null;
  abilities: string[];
  hiddenAbilities: string[];
  levelMoves: [number, string][];
  tutorMoves: string[];
  eggMoves: string[];
  evolutions: { species: string; method: string; param: string | number | null; prevo: boolean }[];
  prevos: string[];
  minimumLevel: number;
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
