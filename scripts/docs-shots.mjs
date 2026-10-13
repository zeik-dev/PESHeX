#!/usr/bin/env node
// Regenera las capturas del README (docs/screenshots/*.png) con Playwright y una carpeta de juego sintetica.
//   npm run docs:shots
import { spawnSync } from "node:child_process";

const r = spawnSync("npx", ["playwright", "test", "e2e/docs.spec.ts"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PESHEX_DOCS: "1" },
});
process.exit(r.status ?? 1);
