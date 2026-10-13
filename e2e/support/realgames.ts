// Carpetas de juego REALES de test_pbs/ (Pokémon Z = Essentials v16-18; Pokémon Añil = v21) para las pruebas e2e.
// Se ensamblan en un directorio temporal con ENLACES SIMBÓLICOS a lo pesado (PBS, Graphics) y copias de los pocos
// archivos de Data que lee el driver: nunca se modifica test_pbs/. Si test_pbs/ no está, `realGame` devuelve null y la
// prueba se omite (`test.skip`).

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./harness";

export type RealGameKey = "z" | "anil";

const CONFIG: Record<RealGameKey, { pbs: string; data?: string; graphics?: string; save: string }> = {
  z: { pbs: "PBS_POKEMON_Z", data: "Data_POKEMON_Z", graphics: "Graphics_POKEMON_Z", save: "Game.rxdata" },
  anil: { pbs: "PBS_POKEMON_ANIL", save: "Partida.rxdata" },
};

const DATA_FILES = ["Scripts.rxdata", "System.rxdata", "MapInfos.rxdata"];

export const TEST_PBS = path.join(ROOT, "test_pbs");

export function realGameAvailable(key: RealGameKey): boolean {
  return fs.existsSync(path.join(TEST_PBS, CONFIG[key].pbs));
}

/** Monta la carpeta del juego `key` dentro de `workDir` y devuelve su raíz (o null si falta test_pbs/). */
export function realGame(key: RealGameKey, workDir: string): string | null {
  if (!realGameAvailable(key)) return null;
  const cfg = CONFIG[key];
  const root = path.join(workDir, `Juego ${key}`);
  fs.mkdirSync(path.join(root, "Data"), { recursive: true });
  fs.symlinkSync(path.join(TEST_PBS, cfg.pbs), path.join(root, "PBS"), "dir");
  if (cfg.data) {
    for (const f of DATA_FILES) {
      const src = path.join(TEST_PBS, cfg.data, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(root, "Data", f));
    }
  }
  if (cfg.graphics && fs.existsSync(path.join(TEST_PBS, cfg.graphics))) {
    fs.symlinkSync(path.join(TEST_PBS, cfg.graphics), path.join(root, "Graphics"), "dir");
  }
  fs.writeFileSync(path.join(root, "Game.ini"), `[Game]\nTitle=${key}\n`);
  return root;
}
