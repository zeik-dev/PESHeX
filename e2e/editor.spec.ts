import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { openSave, ROOT, serveGameAssets, setMode, setup, shot, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const pending = (page: Page, n: number) => expect(page.getByRole("button", { name: `Cambios ${n}` })).toBeVisible();

async function linkGame(page: Page, e: Env) {
  const game = buildFakeGame(ROOT, path.join(e.workDir, "Mi Juego"), e.savePath, { TORRACAT: "Gatito Fuego" });
  e.bridge.dialogDir = game.root;
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });
}

async function openEditor(page: Page, ref = "party/0") {
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.locator(`[data-cell="${ref}"]`).click();
  await page.getByTestId("pc-info").getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  return drawer;
}

test("la hoja de edición es ancha, muestra los stats base del juego y la pestaña Legalidad solo existe en HeX", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);

  const drawer = await openEditor(page);
  const box = (await drawer.boundingBox())!;
  expect(box.width, "algo más de la mitad de la pantalla").toBeGreaterThanOrEqual(1280 * 0.55);
  await expect(drawer.getByTestId("base-stats")).toContainText("Stats base en este juego");
  await expect(drawer.getByTestId("base-stats").getByText(/^Total \d+$/)).toBeVisible();
  for (const stat of ["PS", "Ataque", "Defensa", "At. Esp.", "Def. Esp.", "Velocidad"]) {
    await expect(drawer.getByTestId("base-stats").getByText(stat, { exact: true })).toBeVisible();
  }
  await expect(drawer.getByRole("tab", { name: /Legalidad/ })).toHaveCount(0);
  await shot(page, "120-editor-wide-es-light");
  // Información: las cintas del Pokémon (Partida_2 las trae vacías) salen en su fila.
  await drawer.getByRole("tab", { name: "Información" }).click();
  await expect(drawer.getByTestId("pokemon-ribbons")).toHaveText("—");
  await page.keyboard.press("Escape");

  await setMode(page, "hex");
  await openEditor(page);
  await expect(page.getByRole("dialog").getByRole("tab", { name: /Legalidad/ })).toBeVisible();
});

test("nivel, felicidad y PS tienen deslizador y campo; un gesto es UNA edición; 0 PS es debilitado", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  const drawer = await openEditor(page);

  // Arrastrar con el ratón: muchos «input» pero una sola edición al soltar.
  const slider = drawer.getByRole("slider", { name: "Nivel (deslizador)" });
  const levelBox = drawer.getByRole("textbox", { name: "Nivel", exact: true });
  const before = await levelBox.inputValue();
  const b = (await slider.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height / 2, { steps: 8 });
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2, { steps: 8 });
  await expect(page.getByRole("button", { name: /^Cambios \d/ })).toHaveCount(0); // sin soltar no hay cambio
  await page.mouse.up();
  await pending(page, 1);
  await expect(levelBox).not.toHaveValue(before);
  expect(Number(await levelBox.inputValue())).toBeGreaterThan(Number(before));

  await drawer.getByRole("slider", { name: "Felicidad (deslizador)" }).focus();
  await page.keyboard.press("End");
  await expect(drawer.getByRole("textbox", { name: "Felicidad", exact: true })).toHaveValue("255");

  const hp = drawer.getByRole("textbox", { name: "PS actuales", exact: true });
  await hp.fill("0");
  await hp.press("Enter");
  await expect(drawer.getByText("Debilitado", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("slider", { name: "PS actuales (deslizador)" })).toHaveAttribute("min", "1");
  await shot(page, "121-editor-sliders-es-light");
});

test("las habilidades y los movimientos se filtran por especie (HaX: interruptor activado por defecto; HeX: forzado)", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  const drawer = await openEditor(page);

  const optionCount = async (name: string) => {
    await drawer.getByRole("combobox", { name }).click();
    const n = await page.getByRole("option").count();
    await page.keyboard.press("Escape");
    return n;
  };

  const abilitySwitch = drawer.getByRole("switch", { name: "Mostrar solo habilidades de la Especie" });
  await expect(abilitySwitch).toHaveAttribute("aria-checked", "true");
  const onlySpecies = await optionCount("Habilidad");
  await abilitySwitch.click();
  await expect(abilitySwitch).toHaveAttribute("aria-checked", "false");
  const all = await optionCount("Habilidad");
  expect(onlySpecies).toBeLessThan(all);
  await abilitySwitch.click();

  await drawer.getByRole("tab", { name: /Movimientos/ }).click();
  const moveSwitch = drawer.getByRole("switch", { name: "Mostrar solo movimientos aprendidos por la especie" });
  await expect(moveSwitch).toHaveAttribute("aria-checked", "true");
  const slot = drawer.getByRole("combobox", { name: /Movimiento 1/ });
  await slot.click();
  const learnable = await page.getByRole("option").count();
  await page.keyboard.press("Escape");
  await moveSwitch.click();
  await slot.click();
  const everything = await page.getByRole("option").count();
  await page.keyboard.press("Escape");
  expect(learnable).toBeLessThan(everything);
  // Cada fila enseña tipo, categoría y potencia del juego
  await expect(drawer.getByText(/Pot\. \d+|Estado|Físico|Especial/).first()).toBeVisible();
  await shot(page, "122-editor-moves-es-light");
  await page.keyboard.press("Escape");

  // HeX: el filtro es obligatorio (no hay interruptor)
  await setMode(page, "hex");
  await openEditor(page);
  await expect(page.getByRole("dialog").getByRole("switch", { name: "Mostrar solo habilidades de la Especie" })).toHaveCount(0);
  await page.getByRole("dialog").getByRole("tab", { name: /Movimientos/ }).click();
  await expect(page.getByRole("dialog").getByRole("switch", { name: "Mostrar solo movimientos aprendidos por la especie" })).toHaveCount(0);
});

test("IV y EV: orden de las secciones, Poder oculto, estadísticas totales y recalcular", async ({ page }) => {
  env = await setup(page);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  const drawer = await openEditor(page);
  await drawer.getByRole("tab", { name: "IV y EV" }).click();

  const label = (text: string) => drawer.locator('[class*="sectionLabel"]').getByText(text, { exact: true });
  const y = async (loc: import("@playwright/test").Locator) => (await loc.first().boundingBox())!.y;
  const order = [
    await y(label("IV")),
    await y(drawer.getByTestId("hidden-power")),
    await y(label("Acciones rápidas de IV")),
    await y(label("EV")),
    await y(drawer.getByTestId("ev-presets")),
    await y(label("Estadísticas totales")),
    await y(drawer.getByRole("button", { name: "Recalcular estadísticas" }).last()), // la de arriba es la de «Acciones rápidas»
  ];
  expect(order, "IV → Poder oculto → acciones de IV → EV → presets → totales → recalcular").toEqual([...order].sort((a, b) => a - b));

  await expect(drawer.getByTestId("hidden-power")).toContainText(/potencia \d+/);
  // IV al máximo cambia el Poder oculto (31 en todo = Siniestro) y los totales se calculan con la fórmula del juego
  await drawer.getByRole("button", { name: "IV perfectos (31)" }).click();
  await expect(drawer.getByTestId("hidden-power")).toContainText(/Siniestro|Dark/i);
  await expect(drawer.getByTestId("total-stats")).toContainText("PS");
  await expect(drawer.getByRole("button", { name: "Limpiar EV" })).toBeVisible();
  await expect(drawer.getByRole("slider", { name: "IV PS (deslizador)" })).toHaveValue("31");
  await shot(page, "123-editor-stats-es-light");
});

test("naturaleza por menta (Pokémon Añil): se lee, se cambia y la original no se toca", async ({ page }) => {
  env = await setup(page, "Partida.rxdata");
  await openSave(page, env, "es", "Resumen");
  const drawer = await openEditor(page);
  const mint = drawer.getByLabel("Naturaleza por menta");
  await expect(mint).toHaveValue("SERIOUS");
  await expect(drawer.getByLabel("Naturaleza", { exact: true })).toHaveValue("MODEST");
  await mint.selectOption("ADAMANT");
  await pending(page, 1);
  await expect(drawer.getByTestId("nature-effective")).toContainText(/Firme|Adamant/);
  await expect(drawer.getByLabel("Naturaleza", { exact: true })).toHaveValue("MODEST");
  await mint.selectOption("");
  await expect(drawer.getByTestId("nature-effective")).toContainText(/Modesta|Modest/);
});
