// Llamadas tipadas a los comandos de la iteracion 3 (driver/commands/extras.rb).

import { driverCall } from "./tauri";
import type {
  ExportResult, HallOfFameView, PokedexView, SaveDiff, SearchResult, StatsView, WorldKind, WorldPage, BackupEntry,
} from "./types";

export const extras = {
  pokedex: () => driverCall<PokedexView>("get_pokedex"),
  world: (p: { kind: WorldKind; q?: string; page?: number; pageSize?: number; onlyNonDefault?: boolean }) =>
    driverCall<WorldPage>("get_world", p),
  stats: () => driverCall<StatsView>("get_stats"),
  hallOfFame: () => driverCall<HallOfFameView>("get_hall_of_fame"),
  search: (q: string, limit = 8) => driverCall<SearchResult>("search", { q, limit }),
  backups: () => driverCall<{ backups: BackupEntry[]; savePath: string }>("list_backups"),
  restoreBackup: (file: string) => driverCall<{ restored: string; safetyCopy: string }>("restore_backup", { file }),
  diffBackup: (file: string) => driverCall<SaveDiff>("diff_saves", { file }),
  diffAgainst: (against: string) => driverCall<SaveDiff>("diff_saves", { against }),
  exportPokemon: (ref: string, format: "json" | "showdown") => driverCall<ExportResult>("export_pokemon", { ref, format }),
};
