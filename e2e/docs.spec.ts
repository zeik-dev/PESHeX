// Capturas del README (docs/screenshots/*.png) con una carpeta de juego REAL ya vinculada y analizada.
// No corre en la CI normal: `npm run docs:shots` (o PESHEX_DOCS=1 npx playwright test e2e/docs.spec.ts).
//
//   PESHEX_DOCS_GAME=z          Pokémon Z real: test_saves/Game.rxdata + test_pbs/*_POKEMON_Z (Data, Graphics, PBS).
//   PESHEX_DOCS_GAME=synthetic  respaldo sin test_pbs/: carpeta de juego sintética (círculos de colores en vez de sprites).
//
// Sin la variable se usa Z si existe test_pbs/. Los gráficos de las capturas son los del propio juego del usuario:
// PESHeX no los incluye ni los distribuye.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { openSave, ROOT, serveGameAssets, setup, teardown, type Env } from "./support/harness";
import { realGame, realGameAvailable } from "./support/realgames";

test.skip(!process.env.PESHEX_DOCS, "solo con PESHEX_DOCS=1 (npm run docs:shots)");

let env: Env | undefined;
test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const OUT = path.join(ROOT, "docs", "screenshots");
const REAL = (process.env.PESHEX_DOCS_GAME ?? (realGameAvailable("z") ? "z" : "synthetic")) === "z";

/** Qué se enseña en cada captura según el juego (los nombres cambian entre el Z real y el sintético). */
const DEMO = REAL
  ? { save: "Game.rxdata", trainer: "Kizuga", editRef: "party/1", palette: "milotic", paletteHit: /Milotic/, dexName: "Arcanine", tm: "MT0" }
  : { save: "Partida_2.rxdata", trainer: "Furikita", editRef: "party/1", palette: "grillita", paletteHit: /Grillita/, dexName: "Gatito Fuego", tm: "pot" };

test("capturas del README con la carpeta del juego analizada", async ({ page }) => {
  test.setTimeout(300_000);
  fs.mkdirSync(OUT, { recursive: true });
  const shot = async (name: string) => {
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  };
  const nav = (name: string) => page.getByRole("button", { name, exact: true }).click();

  env = await setup(page, DEMO.save);
  await serveGameAssets(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Ruta estable y corta para que la captura de Ajustes no enseñe un directorio temporal aleatorio.
  const base = path.join(os.tmpdir(), "peshex-docs");
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  const gameDir = REAL
    ? realGame("z", base, "Pokémon Z")
    : buildFakeGame(ROOT, path.join(base, "Mi Juego"), env.savePath, { TORRACAT: "Gatito Fuego" }, { fronts: true }).root;
  if (!gameDir) throw new Error("falta test_pbs/: usa PESHEX_DOCS_GAME=synthetic");
  env.bridge.dialogDir = gameDir;
  await openSave(page, env, "es", DEMO.trainer);

  // Ajustes: la carpeta analizada (datos, límites, calibración)
  await nav("Ajustes");
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(/imágenes indexadas/)).toBeVisible();
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Carpeta del juego" }) });
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await card.screenshot({ path: path.join(OUT, "settings-game.png") });

  // HeX: aviso previo (con la carpeta ya vinculada) y, al aceptar, la tarjeta de legalidad del Resumen
  await page.getByRole("radio", { name: "HeX" }).first().click();
  const warning = page.getByRole("dialog", { name: "Activar el modo HeX" });
  await expect(warning.getByText("Carpeta del juego vinculada")).toBeVisible();
  await page.waitForTimeout(600); // fin de la animacion del dialogo
  await shot("hex-warning");
  await warning.getByRole("button", { name: "Activar HeX" }).click();

  await nav("Resumen");
  await expect(page.getByRole("button", { name: /^Legalidad/, expanded: true })).toBeVisible();
  await shot("overview");

  // PC: equipo, caja y panel de datos compacto; y «Acciones rápidas» desplegado hacia la izquierda
  await nav("PC");
  // La caja que se enseña es la primera con Pokémon (el save puede quedarse en una vacía).
  const boxes = page.locator('select[aria-label="PC"]');
  await boxes.waitFor();
  const populated = await boxes.locator("option").evaluateAll((opts) => opts.find((o) => !/\(0\)/.test(o.textContent ?? ""))?.getAttribute("value") ?? null);
  if (populated != null) await boxes.selectOption(populated);
  await page.locator(`[data-cell="${DEMO.editRef}"]`).click();
  const info = page.getByTestId("pc-info");
  await expect(info.getByRole("button", { name: "Editar", exact: true })).toBeVisible();
  await shot("pc");
  await info.getByRole("button", { name: /Acciones rápidas/ }).click();
  await expect(page.getByRole("menu").or(page.getByRole("dialog", { name: /Acciones rápidas/ })).first()).toBeVisible();
  await shot("pc-acciones");
  await page.keyboard.press("Escape");

  // Hoja de edición ancha: stats base, deslizadores, Poder oculto y EV (más alto para que quepan más secciones)
  await info.getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByTestId("base-stats")).toBeVisible();
  await drawer.getByRole("tab", { name: "IV y EV" }).click();
  await expect(drawer.getByText(/Poder oculto/).first()).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1180 });
  await shot("editor");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");

  // Mochila: «Agregar objeto» arriba con el selector (nombre, icono e id)
  await nav("Mochila");
  const picker = page.getByRole("combobox", { name: "Objeto" }).first();
  await picker.click();
  await picker.fill(DEMO.tm);
  await expect(page.getByRole("option").first()).toBeVisible();
  await shot("bag");
  await page.keyboard.press("Escape");

  // Pokédex: lista y ficha de una especie con los datos del PBS
  await nav("Pokédex");
  await expect(page.getByText(/\d+ vistos · \d+ capturados/)).toBeVisible();
  await shot("pokedex");
  // La ficha se abre sobre la lista completa (sin filtrar), con la especie elegida a la vista y resaltada.
  const row = page.getByRole("button", { name: `Ver la ficha de ${DEMO.dexName}` });
  await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await row.click();
  await expect(page.getByTestId("species-sheet")).toBeVisible();
  await shot("pokedex-ficha");

  await nav("Mundo");
  await expect(page.getByRole("heading", { level: 1, name: "Mundo" })).toBeAttached();
  await shot("world");

  // Ctrl+K
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Buscar y comandos" }).getByRole("combobox").fill(DEMO.palette);
  await expect(page.getByRole("option", { name: DEMO.paletteHit }).first()).toBeVisible();
  await shot("palette");
  await page.keyboard.press("Escape");

  // Copias: guardar un cambio y compararlo con la copia
  await nav("Entrenador");
  await page.getByLabel("Dinero").fill("99999");
  await page.getByLabel("Dinero").press("Enter");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Partida guardada.")).toBeVisible();
  await nav("Copias");
  await page.getByRole("button", { name: "Comparar", exact: true }).click();
  await expect(page.getByTestId("diff-view")).toBeVisible();
  await page.getByText("Partida guardada.").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => undefined);
  await shot("diff");
  fs.rmSync(base, { recursive: true, force: true });
});
