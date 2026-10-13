// Capturas del README (docs/screenshots/*.png) con una carpeta de juego SINTETICA ya vinculada y analizada.
// No corre en la CI normal: `npm run docs:shots` (o PESHEX_DOCS=1 npx playwright test e2e/docs.spec.ts).
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { openSave, ROOT, serveGameAssets, setup, teardown, type Env } from "./support/harness";

test.skip(!process.env.PESHEX_DOCS, "solo con PESHEX_DOCS=1 (npm run docs:shots)");

let env: Env | undefined;
test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const OUT = path.join(ROOT, "docs", "screenshots");

test("capturas del README con la carpeta del juego analizada", async ({ page }) => {
  test.setTimeout(180_000);
  fs.mkdirSync(OUT, { recursive: true });
  const shot = (name: string) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const nav = (name: string) => page.getByRole("button", { name, exact: true }).click();

  env = await setup(page);
  await serveGameAssets(page);
  await page.setViewportSize({ width: 1360, height: 1120 });
  await openSave(page, env);

  // Ruta estable y corta para que la captura de Ajustes no enseñe un directorio temporal aleatorio.
  const gameDir = path.join(os.tmpdir(), "peshex-docs", "Mi Juego");
  fs.rmSync(path.dirname(gameDir), { recursive: true, force: true });
  const game = buildFakeGame(ROOT, gameDir, env.savePath, { TORRACAT: "Gatito Fuego" }, { fronts: true });
  env.bridge.dialogDir = game.root;
  await nav("Ajustes");
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Legalidad completa")).toBeVisible();

  // Ajustes: la carpeta analizada (datos, límites, calibración y legalidad)
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Carpeta del juego" }) });
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: path.join(OUT, "settings-game.png") });

  // Zoom de la app
  const zoomCard = page.locator("section", { has: page.getByRole("heading", { name: "Zoom de la aplicación" }) });
  await zoomCard.scrollIntoViewIfNeeded();
  await zoomCard.screenshot({ path: path.join(OUT, "settings-zoom.png") });

  // HeX: aviso previo (con la carpeta ya vinculada) y, al aceptar, la tarjeta de legalidad del Resumen
  await page.getByRole("radio", { name: "HeX" }).first().click();
  const warning = page.getByRole("dialog", { name: "Activar el modo HeX" });
  await expect(warning.getByText("Carpeta del juego vinculada")).toBeVisible();
  await page.waitForTimeout(600); // fin de la animacion del dialogo
  await shot("hex-warning");
  await warning.getByRole("button", { name: "Activar HeX" }).click();

  await nav("Resumen");
  await expect(page.getByRole("button", { name: /^Legalidad/, expanded: true })).toBeVisible();
  await expect(page.getByText("Legalidad completa").first()).toBeVisible();
  await page.waitForTimeout(400);
  await shot("overview");

  await nav("PC");
  await page.locator('[data-cell="party/1"]').click();
  await expect(page.getByTestId("pc-info").getByTestId("ev-presets")).toBeVisible();
  await page.waitForTimeout(500);
  await shot("pc");

  await nav("Pokédex");
  await expect(page.getByText(/\d+ vistos · \d+ capturados/)).toBeVisible();
  await page.waitForTimeout(400);
  await shot("pokedex");

  await nav("Mundo");
  await expect(page.getByText("Medalla 1")).toBeVisible();
  await page.waitForTimeout(300);
  await shot("world");

  // Ctrl+K
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Buscar y comandos" }).getByRole("combobox").fill("grillita");
  await expect(page.getByRole("option", { name: /Grillita/ })).toBeVisible();
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
  await page.waitForTimeout(400);
  await shot("diff");
  fs.rmSync(path.dirname(gameDir), { recursive: true, force: true });
});
