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
  // En HaX la hoja no tiene pestaña «Legalidad» ni el Resumen su tarjeta: la legalidad solo existe con HeX activo
  await expect(drawer.getByRole("tab", { name: /Legalidad/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Legalidad/ })).toHaveCount(0);

  // Con HeX activo aparece (lo que la partida ya traia no se bloquea; el nivel 150 si se ve como ilegal)
  await setMode(page, "hex");
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await page.getByRole("button", { name: /^Trump/ }).click();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("dialog").getByRole("tab", { name: /Legalidad/ }).click();
  await expect(page.getByRole("dialog").getByText(/Nivel 150 fuera del rango permitido \(1–100\)/)).toBeVisible();
  await shot(page, "102-legality-tab-es-light");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Resumen", exact: true }).click();

  // Resumen: tarjeta de legalidad con el problema y enlace a verlo.
  const card = page.getByRole("heading", { name: /^Legalidad/ });
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

  // HeX (ya activo) rechaza otra ilegalidad en ese mismo Pokemon pero deja editar lo legal.
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

test("la tarjeta «Legalidad» del Resumen solo existe en HeX y se despliega y pliega", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();

  // HaX (por defecto): nada de legalidad en el Resumen
  await expect(page.getByRole("heading", { name: /^Legalidad/ })).toHaveCount(0);

  // HeX: aparece, desplegada
  await setMode(page, "hex");
  const toggle = page.getByRole("button", { name: /^Legalidad/, expanded: true });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("title", "Ocultar la legalidad");
  const body = page.locator("#" + (await toggle.getAttribute("aria-controls")));
  await expect(body.getByText("Legalidad completa")).toBeVisible();
  await expect(body.getByText(/reglas comprobadas/)).toBeVisible();
  await shot(page, "106-legality-collapsible-open-es-light");

  // Plegar: el contenido se oculta y la cabecera conserva el resumen
  await toggle.click();
  const closed = page.getByRole("button", { name: /^Legalidad/, expanded: false });
  await expect(closed).toBeVisible();
  await expect(closed).toHaveAttribute("title", "Mostrar la legalidad");
  await expect(body.getByText("Legalidad completa")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Legalidad/ }).getByText("Todo en regla")).toBeVisible();
  await shot(page, "107-legality-collapsible-closed-es-light");

  // Se recuerda al cambiar de vista y volver
  await page.getByRole("button", { name: "Entrenador", exact: true }).click();
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Legalidad/, expanded: false })).toBeVisible();
  await page.getByRole("button", { name: /^Legalidad/, expanded: false }).click();
  await expect(page.getByRole("button", { name: /^Legalidad/, expanded: true })).toBeVisible();

  // Volver a HaX la quita otra vez
  await setMode(page, "hax");
  await expect(page.getByRole("heading", { name: /^Legalidad/ })).toHaveCount(0);
});

test("sin carpeta del juego la legalidad es básica y lo dice", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await setMode(page, "hex");
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
