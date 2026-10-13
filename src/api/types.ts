// Tipos de los DTO que devuelve el driver Ruby (driver/semantic/model.rb).
// Las claves vienen en camelCase tal cual las emite el driver.

export interface ApiError {
  kind: string;
  message: string;
  params?: Record<string, unknown> | null;
  fatal?: boolean;
}

export type Confidence = "high" | "medium" | "low";

export interface EvidenceItem {
  code: string;
  params: Record<string, unknown>;
}

export interface RoleInfo {
  path: string;
  class: string | null;
  via: "profile" | "discovered";
  ivar: string | null;
}

export interface Ambiguity {
  role: string;
  candidates: { path: string; class: string | null; score: number }[];
}

export interface OverlayInfo {
  id: string;
  confidence: string;
  evidence: EvidenceItem[];
}

export interface Profile {
  id: string;
  family: string;
  label: string;
  format: string;
  essentialsVersion: string | null;
  gameVersion: string | null;
  confidence: Confidence;
  score: number;
  evidence: EvidenceItem[];
  ambiguities: Ambiguity[];
  overlays: OverlayInfo[];
  idStyle: string | null;
  statLayout: string | null;
  editable: boolean;
  confirmed: boolean;
  roles: Record<string, RoleInfo>;
  alternatives: { id: string; score: number }[];
  counts: { pokemon: number; objects: number };
}

export interface OpenResult {
  roots: number;
  wrapper: string;
  fileSize: number;
  indexState: string;
  roundtripChecked: boolean;
  revision: number;
  profile: Profile;
  /** Carpeta de juego encontrada junto al save (solo juegos portables/antiguos). */
  gameSuggestion?: string;
  mode?: Mode;
}

export interface RoundtripResult {
  roundtripClean: boolean;
  diffByte: number | null;
}

export interface Limits {
  maxLevel: number;
  maxMoney: number;
  maxCoins: number;
  maxBattlePoints: number;
  maxSoot: number;
  partySize: number;
  ivMax: number;
  evStatMax: number;
  evTotalMax: number;
  bagPerSlot: number;
  ppMax: number;
  happinessMax: number;
  boxCount: number;
  maxPlayerName: number;
  maxNickname: number;
  maxMoves: number;
}

export interface IdRef {
  id: string | number;
  name: string;
}

export interface Extra {
  name: string;
  kind: string;
  display: string;
  value?: string | number | boolean | null;
  count?: number;
  custom: boolean;
  editable: boolean;
  fieldPath: string;
}

export interface Trainer {
  ref: string;
  fieldPath: string;
  class: string | null;
  name: string | null;
  id: number | null;
  trainerType: string | number | null;
  gender: number | null;
  language: number | null;
  money: number | null;
  coins: number | null;
  battlePoints: number | null;
  soot: number | null;
  available: string[];
  badges: boolean[];
  playTime: number | null;
  lastSaved: string | null;
  extras: Extra[];
  limits: Limits;
}

export interface PokemonSummary {
  ref: string;
  species: IdRef | null;
  form: number | null;
  nickname: string | null;
  level: number | null;
  gender: number | null;
  shiny: boolean;
  egg: boolean;
  hp: number | null;
  totalHp: number | null;
  item: IdRef | null;
  status: string | number | null;
  /** Valor guardado: id del objeto (v19+) o indice de $BallTypes (v16-18). */
  ball: string | number | null;
  /** La bola como objeto del juego (resuelta por el driver, tambien en bases antiguas). */
  ballItem?: IdRef | null;
}

export type StatId = "HP" | "ATTACK" | "DEFENSE" | "SPECIAL_ATTACK" | "SPECIAL_DEFENSE" | "SPEED";
export const STAT_IDS: StatId[] = ["HP", "ATTACK", "DEFENSE", "SPECIAL_ATTACK", "SPECIAL_DEFENSE", "SPEED"];
export type StatMap = Record<StatId, number | null>;

export interface MoveDto {
  slot: number;
  id: string | number | null;
  name: string | null;
  pp: number | null;
  ppUps: number | null;
}

export interface PokemonDetail extends PokemonSummary {
  fieldPath: string;
  shared: string[];
  exp: number | null;
  superShiny: boolean;
  nature: IdRef | null;
  natureForStats: IdRef | null;
  /** Que admite la base de este Pokémon (la naturaleza por menta solo existe en v20+). */
  capabilities?: { natureForStats: boolean };
  ability: IdRef | null;
  abilityIndex: number | null;
  statusCount: number | null;
  happiness: number | null;
  ball: string | number | null;
  iv: StatMap;
  ev: StatMap;
  evTotal: number;
  ivLayout: string | null;
  evLayout: string | null;
  flags: Flag[];
  stats: { cached: StatMap; computed?: Record<StatId, number>; match?: boolean; trusted?: boolean };
  /** Grupo de experiencia y umbrales (solo con carpeta del juego vinculada). */
  growth: { rate: string; expAtLevel: number; expAtNext: number; minimumLevel: number } | null;
  moves: MoveDto[];
  owner: { name: string | null; id: number | null; gender: number | null } | null;
  personalId: number | null;
  extras: Extra[];
  limits: Limits;
}

export interface Overview {
  profile: Profile;
  trainer: Pick<
    Trainer,
    "name" | "id" | "trainerType" | "gender" | "money" | "coins" | "battlePoints" | "soot" | "badges" | "playTime" | "lastSaved" | "available" | "limits"
  > | null;
  party: PokemonSummary[];
  counts: { boxes: number | null; boxPokemon: number | null; bagItems: number | null; pokemonTotal: number };
  pokedex: { seen: number | null; owned: number | null } | null;
}

export interface BagSlot {
  ref: string;
  id: string | number;
  name: string;
  qty: number;
  favourite: boolean;
  registered: boolean;
}

export interface BagPocket {
  index: number;
  key: string | null;
  ref: string;
  slots: BagSlot[];
  count: number;
  fieldPath: string;
}

export interface Bag {
  ref: string;
  fieldPath: string;
  layout: string;
  pockets: BagPocket[];
  totalItems: number;
  extras: Extra[];
  limits: Limits;
}

export interface BoxDto {
  index: number;
  name: string | null;
  slots: (PokemonSummary | null)[];
  filled: number;
  fieldPath: string;
  /** Indice del fondo de la caja (@background), si el save lo guarda. */
  background?: number | null;
}

export interface Storage {
  ref: string;
  fieldPath: string;
  currentBox: number | null;
  boxes: BoxDto[];
  total: number;
  extras: Extra[];
}

export type Bucket = "classified" | "custom" | "world" | "unclassified";

export interface Coverage {
  total: number;
  buckets: Record<Bucket, number>;
  groupCount: number;
}

export interface CoverageGroup {
  key: string;
  class: string;
  ivar: string;
  bucket: Bucket;
  leafCount: number;
  samplePath: string;
}

export interface UnclassifiedPage {
  total: number;
  buckets: Record<Bucket, number>;
  page: number;
  pageSize: number;
  groups: CoverageGroup[];
}

export type Mode = "hex" | "hax";
export type FlagSeverity = "illegal" | "warning" | "info";

/** Hallazgo de legalidad; el texto lo pone la UI con `legality.flag.<code>` + params. */
export interface Flag {
  code: string;
  severity: FlagSeverity;
  subject?: string;
  params: Record<string, unknown>;
  ref?: string;
}

export interface LegalityCoverage {
  level: "full" | "partial" | "basic";
  reasons: string[];
  evaluated: string[];
  skipped: { code: string; reason: string }[];
}

export interface LegalityReport {
  mode: Mode;
  coverage: LegalityCoverage;
  summary: { illegal: number; warning: number; info: number; checked: number; refs: number };
  flags: Record<string, Flag[]>;
}

export interface Issue {
  severity: "error" | "warning" | "info";
  code: string;
  params: Record<string, unknown>;
  ref?: string;
}

export type EditOp =
  | { op: "set"; ref: "trainer"; field: string; value: string | number | boolean | null }
  | { op: "trainer.badge"; index: number; value: boolean }
  | { op: "pokemon.patch"; ref: string; patch: PokemonPatch }
  | { op: "bag.set"; ref: string; qty: number }
  | { op: "bag.set"; pocket: number; id: string | number; qty: number }
  | { op: "extra.set"; ref: string; ivar: string; value: string | number | boolean | null }
  | { op: "pokemon.move"; from: string; to: string }
  | { op: "pokemon.remove"; ref: string }
  | { op: "pokemon.heal"; ref: string }
  | { op: "pokemon.recalc"; ref: string }
  | { op: "pokemon.level"; ref: string; level: number }
  | { op: "pokemon.clone"; ref: string; to?: string }
  | { op: "pokemon.add"; to?: string; data: PokemonImport }
  | { op: "box.patch"; index: number; name?: string; background?: number }
  | { op: "pokedex.set"; id: string; seen?: boolean; owned?: boolean }
  | { op: "pokedex.bulk"; mode: PokedexBulkMode; ids: string[] }
  | { op: "world.switch"; id: number; value: boolean }
  | { op: "world.variable"; id: number; value: number | string | null };

export type PokedexBulkMode = "seen_all" | "owned_all" | "clear_all" | "unown_all";

/** Datos de un Pokemon que se crea (importar/crear): ver `Sem::Transfer` en el driver. */
export interface PokemonImport extends PokemonPatch {
  species: string;
  /** false = no recalcular estadisticas aunque se pueda. */
  recalc?: boolean;
}

export interface PokemonPatch {
  species?: string | number;
  level?: number;
  exp?: number;
  nickname?: string | null;
  form?: number;
  gender?: number;
  shiny?: boolean;
  nature?: string;
  ability?: string;
  abilityIndex?: number;
  item?: string | number | null;
  happiness?: number;
  ball?: string;
  status?: string;
  hp?: number;
  iv?: Partial<Record<StatId, number>>;
  ev?: Partial<Record<StatId, number>>;
  moves?: { slot: number; id?: string; pp?: number; ppUps?: number; remove?: boolean }[];
}

export interface ApplyResult {
  applied: boolean;
  reason?: string;
  undoId?: number;
  refs?: string[];
  issues?: Issue[];
  pendingCount?: number;
  structural?: boolean;
  /** HeX: la edicion introduciria ilegalidades y no se aplico. */
  rejected?: { code: string; mode: Mode; flags: Flag[] };
  /** Flags nuevas que introdujo la edicion (en HaX se avisa, no se bloquea). */
  newFlags?: Flag[];
  revision?: number;
}

export interface ChangeEntry {
  op: string;
  path: string;
  old: ValueSummary;
  new: ValueSummary;
  txId: number;
  label: { key: string; params?: Record<string, unknown> };
}

export interface ValueSummary {
  kind: string;
  display: string;
  value?: string | number | boolean | null;
}

export interface HistoryTx {
  id: number;
  label: { key: string; params?: Record<string, unknown> };
  refs: string[];
  at: string;
  changes: Omit<ChangeEntry, "txId" | "label">[];
}

export interface History {
  undo: HistoryTx[];
  redoCount: number;
  pendingCount: number;
}

export interface SaveResult {
  applied: boolean;
  reason?: string;
  needsConfirmation?: boolean;
  rejected?: { code: string; mode: Mode; flags: Flag[] };
  message?: string;
  issues?: Issue[];
  bytesWritten?: number;
  backupPath?: string;
  changesApplied?: number;
}

// ── Iteracion 3: Pokedex, mundo, estadisticas, copias, comparacion, busqueda ──

export interface PokedexView {
  available: boolean;
  path?: string;
  layout?: "hash" | "array";
  seen?: string[];
  owned?: string[];
  caught?: Record<string, number>;
  defeated?: Record<string, number>;
  /** Todas las especies que el save menciona (vistas, capturadas o con contadores). */
  ids?: string[];
  unlockedDexes?: number[] | null;
}

export type WorldKind = "switches" | "variables";

export interface WorldRow {
  id: number;
  name: string | null;
  value: ValueSummary;
}

export interface WorldPage {
  available: boolean;
  kind: WorldKind;
  path?: string;
  total?: number;
  count?: number;
  page?: number;
  pageSize?: number;
  /** Hay nombres (Data/System.rxdata de la carpeta del juego). */
  named?: boolean;
  rows?: WorldRow[];
}

export interface StatEntry {
  name: string;
  value: ValueSummary;
  group: "battle" | "money" | "travel" | "pokemon" | "time" | "other";
}

export interface StatsView {
  available: boolean;
  path?: string;
  playTime?: number | null;
  entries?: StatEntry[];
}

export interface HallOfFameEntry {
  index: number;
  members: PokemonSummary[];
  display: string;
}

export interface HallOfFameView {
  available: boolean;
  path?: string;
  entries?: HallOfFameEntry[];
}

export interface SearchHit {
  ref?: string;
  index?: number;
  id?: string | number;
  kind?: WorldKind;
  label: string;
  sub?: string;
}

export interface SearchResult {
  q: string;
  total: number;
  groups: Partial<Record<"pokemon" | "items" | "boxes" | "world", SearchHit[]>>;
}

export interface BackupEntry {
  file: string;
  size: number;
  mtime: string;
  stamp: string;
  kind: "backup" | "prerestore";
}

export interface DiffMon {
  ref: string;
  species: string | null;
  nickname: string | null;
  level: number | null;
}

export interface FieldDiff {
  field: string;
  a: unknown;
  b: unknown;
}

export interface SaveDiff {
  against: string;
  profile: { current: string; other: string };
  trainer: FieldDiff[];
  bag: { id: string; name: string | null; a: number; b: number }[];
  pokemon: {
    added: DiffMon[];
    removed: DiffMon[];
    changed: (DiffMon & { against: string; diffs: FieldDiff[] })[];
    moved: (DiffMon & { from: string })[];
    totals: { current: number; other: number };
  };
  pokedex: { available?: boolean; seenAdded: string[]; seenRemoved: string[]; ownedAdded: string[]; ownedRemoved: string[] };
  world: Record<WorldKind, { changed: number; sample: { id: number; name: string | null; a: string; b: string }[] }>;
  summary: {
    trainer: number; bag: number; pokemonAdded: number; pokemonRemoved: number; pokemonChanged: number;
    pokemonMoved: number; pokedex: number; world: number;
  };
}

export type ExportResult =
  | { format: "json"; data: Record<string, unknown> }
  | { format: "showdown"; text: string };
