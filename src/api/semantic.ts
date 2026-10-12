// Llamadas tipadas a las vistas semanticas del driver (driver/commands/semantic.rb).

import { driverCall } from "./tauri";
import type {
  ApplyResult, Bag, ChangeEntry, Coverage, EditOp, History, Overview, PokemonDetail, PokemonSummary,
  Profile, RoundtripResult, SaveResult, Storage, Trainer, UnclassifiedPage,
} from "./types";

export const semantic = {
  verifyRoundtrip: () => driverCall<RoundtripResult>("verify_roundtrip"),
  overview: () => driverCall<Overview>("get_overview"),
  trainer: async () => (await driverCall<{ trainer: Trainer | null }>("get_trainer")).trainer,
  party: async () => (await driverCall<{ party: PokemonSummary[] }>("list_party")).party,
  pokemon: async (ref: string) => (await driverCall<{ pokemon: PokemonDetail }>("get_pokemon", { ref })).pokemon,
  storage: async () => (await driverCall<{ storage: Storage | null }>("list_boxes")).storage,
  bag: async () => (await driverCall<{ bag: Bag | null }>("get_bag")).bag,
  coverage: () => driverCall<Coverage>("get_coverage"),
  unclassified: (params: { bucket?: string; q?: string; page?: number; pageSize?: number }) =>
    driverCall<UnclassifiedPage>("list_unclassified", params),

  applyOps: (ops: EditOp[], opts: { confirmed?: boolean } = {}) =>
    driverCall<ApplyResult>("apply_ops", { ops, confirmed: !!opts.confirmed }),
  undo: () => driverCall<{ applied: boolean; pendingCount?: number; redoCount?: number }>("undo"),
  redo: () => driverCall<{ applied: boolean; pendingCount?: number; redoCount?: number }>("redo"),
  undoAll: () => driverCall<{ applied: boolean; pendingCount: number; redoCount: number }>("undo_all"),
  history: () => driverCall<History>("list_history"),
  changes: () =>
    driverCall<{ count: number; opCount: number; redoCount: number; changes: ChangeEntry[] }>("list_changes"),
  save: (opts: { backup: boolean; confirmed?: boolean }) =>
    driverCall<SaveResult>("save", { backup: opts.backup, confirmed: !!opts.confirmed }),
  setProfileOverride: async (profileId: string | null) =>
    (await driverCall<{ profile: Profile }>("set_profile_override", { profileId })).profile,
};
