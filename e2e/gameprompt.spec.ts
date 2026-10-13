import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { openSave, ROOT, serveGameAssets, setup, shot, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const prompt = (page: Page) => page.getByRole("dialog", { name: "Carpeta del juego" });

async function storedPrompt(page: Page, savePath: string): Promise<boolean> {
  return page.evaluate((p) => {
    const raw = localStorage.getItem("peshex-settings");
    return !!raw && !!JSON.parse(raw).state?.noGamePrompt?.[p];
  }, savePath);
}

test("al abrir una partida sin carpeta de juego se ofrece agregarla, con progreso real", async ({ page }) => {
  env = await setup(page, "Partida_2.rxdata", { gamePrompt: true });
  const game = buildFakeGame(ROOT, path.join(env.workDir, "Mi Juego"), env.savePath, {});
  env.bridge.dialogDir = game.root;
  env.bridge.stepDelayMs = 350; // para poder ver la barra avanzar
  await serveGameAssets(page);
  await openSave(page, env);

  const dialog = prompt(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Agregar directorio de juego" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "No volver a preguntar para esta partida" })).not.toBeChecked();
  await shot(page, "90-game-prompt-es-light");

  await dialog.getByRole("button", { name: "Agregar directorio de juego" }).click();
  // Mientras carga: barra de progreso con el paso actual; los botones quedan deshabilitados.
  const bar = dialog.getByRole("progressbar");
  await expect(bar).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  await expect(bar).toHaveAttribute("aria-valuetext", /Leyendo|Comprobando|Indexando|Preparando|Cargando/);
  await shot(page, "91-game-progress-es-light");
  const seen = new Set<string>();
  await expect
    .poll(async () => {
      const v = await bar.getAttribute("aria-valuenow", { timeout: 200 }).catch(() => null);
      if (v) seen.add(v);
      return await dialog.count();
    }, { timeout: 30_000, intervals: [100] })
    .toBe(0);
  expect(seen.size, "la barra pasa por varios valores intermedios").toBeGreaterThan(2);

  // La carpeta quedó vinculada: Ajustes la muestra y el aviso no vuelve.
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await expect(page.getByText("Datos completos")).toBeVisible();
});

test("«Cancelar» cierra el aviso y «No volver a preguntar» se recuerda para esa partida", async ({ page }) => {
  env = await setup(page, "Partida_2.rxdata", { gamePrompt: true });
  await openSave(page, env);

  const dialog = prompt(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await storedPrompt(page, env.savePath)).toBe(false);

  // Cerrar y volver a abrir: sin la casilla, el aviso vuelve.
  await page.getByRole("button", { name: "Cerrar archivo" }).click();
  await page.getByRole("button", { name: "Abrir partida…" }).click();
  await expect(dialog).toBeVisible();

  await dialog.getByRole("checkbox", { name: "No volver a preguntar para esta partida" }).check();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
  expect(await storedPrompt(page, env.savePath)).toBe(true);

  await page.getByRole("button", { name: "Cerrar archivo" }).click();
  await page.getByRole("button", { name: "Abrir partida…" }).click();
  await expect(page.getByText("Furikita").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await expect(dialog).toHaveCount(0);
});

test("Esc también cierra el aviso, y en inglés se traduce", async ({ page }) => {
  env = await setup(page, "Partida_2.rxdata", { gamePrompt: true });
  await openSave(page, env, "en");
  const dialog = page.getByRole("dialog", { name: "Game folder" });
  await expect(dialog.getByRole("button", { name: "Add game folder" })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Don't ask again for this save" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
