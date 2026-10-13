import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { openSave, ROOT, serveGameAssets, setMode, setup, shot, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

async function linkGame(page: Page, e: Env) {
  const game = buildFakeGame(ROOT, path.join(e.workDir, "Mi Juego"), e.savePath, { TORRACAT: "Gatito Fuego" });
  e.bridge.dialogDir = game.root;
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });
}

const modeBtn = (page: Page, name: "HeX" | "HaX") => page.getByRole("radio", { name }).first();

test("el modo por defecto es HaX y activar HeX pide confirmación con un aviso", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await expect(modeBtn(page, "HaX")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/Modo HaX activo/)).toHaveCount(0); // ya no hay franja de aviso

  // HeX: aviso (depende de la carpeta del juego; puede fallar en algunos fangames) y se puede cancelar
  await modeBtn(page, "HeX").click();
  const dialog = page.getByRole("dialog", { name: "Activar el modo HeX" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Depende de la carpeta del juego/)).toBeVisible();
  await expect(dialog.getByText(/Puede equivocarse en algunos fangames/)).toBeVisible();
  await expect(dialog.getByText("Todavía no has vinculado la carpeta del juego")).toBeVisible();
  await shot(page, "100-hex-warning-es-light");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(modeBtn(page, "HaX")).toHaveAttribute("aria-checked", "true");

  // sin carpeta vinculada se ofrece ir a vincularla
  await modeBtn(page, "HeX").click();
  await dialog.getByRole("button", { name: "Vincular carpeta del juego" }).click();
  await expect(page.getByRole("heading", { name: "Carpeta del juego" })).toBeVisible();
  await expect(modeBtn(page, "HaX")).toHaveAttribute("aria-checked", "true");

  // al aceptar, HeX queda activo y se recuerda al volver a abrir
  await setMode(page, "hex");
  await page.getByRole("button", { name: "Cerrar archivo" }).click();
  await page.getByRole("button", { name: "Abrir partida…" }).click();
  await expect(modeBtn(page, "HeX")).toHaveAttribute("aria-checked", "true");
  await setMode(page, "hax"); // volver a HaX no pide confirmación
});

test("con la carpeta del juego vinculada el aviso de HeX lo refleja", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  await modeBtn(page, "HeX").click();
  const dialog = page.getByRole("dialog", { name: "Activar el modo HeX" });
  await expect(dialog.getByText("Carpeta del juego vinculada")).toBeVisible();
  await expect(dialog.getByText("Legalidad completa")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Vincular carpeta del juego" })).toHaveCount(0);
});

test("guardar cambios hechos en HaX no se puede en HeX hasta cambiar de modo", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "Entrenador", exact: true }).click();
  await page.getByLabel("Dinero").fill("99999999");
  await page.getByLabel("Dinero").press("Enter");
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();

  await setMode(page, "hex");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  const dialog = page.getByRole("dialog", { name: "No se puede guardar en HeX" });
  await expect(dialog).toBeVisible();
  await shot(page, "101-hex-save-rejected-es-light");
  await dialog.getByRole("button", { name: "Cambiar a HaX" }).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Partida guardada.")).toBeVisible();
});

test("legalidad con la carpeta del juego: resumen, editor, insignias y filtro de ilegales", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);

  // Provocar una ilegalidad desde el editor (nivel fuera de rango).
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await page.getByRole("button", { name: /^Trump/ }).click();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  const level = drawer.getByLabel("Nivel", { exact: true });
  await level.fill("150");
  await level.press("Enter");
  await drawer.getByRole("tab", { name: /Legalidad/ }).click();
  await expect(drawer.getByText(/Nivel 150 fuera del rango permitido \(1–100\)/)).toBeVisible();
  await shot(page, "102-legality-tab-es-light");
  await page.keyboard.press("Escape");

  // Resumen: tarjeta de legalidad con el problema y enlace a verlo.
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  const card = page.getByText("Legalidad", { exact: true }).first();
  await expect(card).toBeVisible();
  await expect(page.getByText("1 ilegal").first()).toBeVisible();
  await shot(page, "103-legality-card-es-light");

  // Equipo: insignia en el panel de datos y filtro "solo ilegales" en el PC.
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.getByText("Solo ilegales").click();
  await expect(page.getByTestId("pc-party").locator('[data-cell="party/0"]')).not.toHaveClass(/dim/);
  await expect(page.getByTestId("pc-party").locator('[data-cell="party/1"]')).toHaveClass(/dim/);
  await page.getByTestId("pc-party").locator('[data-cell="party/0"]').click();
  await expect(page.getByTestId("pc-info").getByText("1 ilegal")).toBeVisible();
  await shot(page, "104-pc-illegal-filter-es-light");

  // HeX rechaza otra ilegalidad en ese mismo Pokemon pero deja editar lo legal.
  await setMode(page, "hex");
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await page.getByRole("button", { name: /^Trump/ }).click();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Apodo").fill("Rayo");
  await page.getByRole("dialog").getByLabel("Apodo").press("Enter");
  await expect(page.getByRole("dialog", { name: /no permitido/ })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("tab", { name: "IV y EV" }).click();
  const iv = page.getByRole("textbox", { name: "IV PS" });
  await iv.fill("99");
  await iv.press("Enter");
  await expect(page.getByRole("dialog", { name: "Cambio no permitido en HeX" })).toBeVisible();
  await expect(page.getByText(/IV de PS = 99/)).toBeVisible();
});

test("sin carpeta del juego la legalidad es básica y lo dice", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await expect(page.getByText("Legalidad básica")).toBeVisible();
  await expect(page.getByText("No hay carpeta de juego vinculada.")).toBeVisible();
});

test("modos en inglés y modo oscuro", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env, "en", "Furikita");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit mode" })).toBeVisible();
  await page.getByRole("radio", { name: "HeX" }).first().click();
  await expect(page.getByRole("dialog", { name: "Turn on HeX mode" }).getByText(/It depends on the game folder/)).toBeVisible();
  await page.getByRole("dialog", { name: "Turn on HeX mode" }).getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: /^Theme/ }).click();
  await page.getByRole("button", { name: /^Theme/ }).click();
  await shot(page, "105-mode-settings-en-dark");
});
