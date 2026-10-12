import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { loadedGameImages, openSave, ROOT, serveGameAssets, setup, shot, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

interface Layout {
  filledBox: number;
  filled: string[];
  empty: string[];
}

/** Donde hay Pokemon y huecos en el PC del save de pruebas. */
async function layout(e: Env): Promise<Layout> {
  const res = (await e.bridge.handle("open_save", { path: e.savePath })) as { error?: unknown };
  expect(res.error).toBeUndefined();
  const r = (await e.bridge.handle("driver_call", { cmd: "list_boxes", params: {} })) as {
    value: { storage: { boxes: { index: number; slots: (unknown | null)[] }[] } };
  };
  const boxes = r.value.storage.boxes;
  const filledBox = boxes.find((b) => b.slots.some(Boolean))!.index;
  const box = boxes[filledBox];
  return {
    filledBox,
    filled: box.slots.flatMap((s, i) => (s ? [`box/${filledBox}/${i}`] : [])),
    empty: box.slots.flatMap((s, i) => (!s ? [`box/${filledBox}/${i}`] : [])),
  };
}

async function linkGame(page: Page, e: Env) {
  const game = buildFakeGame(ROOT, path.join(e.workDir, "Mi Juego"), e.savePath, { TORRACAT: "Gatito Fuego" });
  e.bridge.dialogDir = game.root;
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByRole("button", { name: "Elegir carpeta…" }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });
}

async function goToBox(page: Page, box: number) {
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.getByRole("combobox").first().selectOption(String(box)).catch(() => undefined);
}

/** Arrastra con el raton real, en varios pasos (el hook usa un umbral de 5 px). */
async function drag(page: Page, from: string, to: string) {
  const a = (await page.locator(`[data-cell="${from}"]`).boundingBox())!;
  const b = (await page.locator(`[data-cell="${to}"]`).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

test("el PC se ve como una caja de los juegos con los sprites del juego", async ({ page }) => {
  env = await setup(page);
  const lay = await layout(env);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  await goToBox(page, lay.filledBox);

  const box = page.getByTestId("pc-box");
  await expect(box).toHaveAttribute("data-box-art", "game");
  // 30 casillas, tantas con Pokemon como hay en la caja, y sprites reales cargados.
  await expect(box.locator("[data-cell]")).toHaveCount(30);
  await expect(box.locator("[data-ref]")).toHaveCount(lay.filled.length);
  await expect.poll(() => loadedGameImages(page)).toBeGreaterThan(lay.filled.length);
  // La rejilla sigue la geometria del bitmap (324x296): 6 columnas, paso de 48 px por la escala.
  const first = (await box.locator('[data-cell$="/0"]').boundingBox())!;
  const second = (await box.locator('[data-cell$="/1"]').boundingBox())!;
  const scale = ((await box.boundingBox())!.width - 6) / 324; // menos el borde de 3 px
  expect(Math.round(second.x - first.x)).toBe(Math.round(48 * scale));
  await shot(page, "90-pc-game-es-light");

  // Seleccionar muestra los datos al estilo de la pantalla de resumen.
  await box.locator(`[data-cell="${lay.filled[0]}"]`).click();
  const info = page.getByTestId("pc-info");
  await expect(info).toBeVisible();
  await expect(info.getByText("Movimientos")).toBeVisible();
  await shot(page, "91-pc-info-es-light");
});

test("sin carpeta del juego el PC usa marcadores y un fondo propio", async ({ page }) => {
  env = await setup(page);
  const lay = await layout(env);
  await openSave(page, env);
  await goToBox(page, lay.filledBox);
  await expect(page.getByTestId("pc-box")).toHaveAttribute("data-box-art", "css");
  await expect(page.getByText("Vincula la carpeta de tu juego")).toBeVisible();
  await expect(page.getByTestId("pc-box").locator("[data-ref]")).toHaveCount(lay.filled.length);
  await shot(page, "92-pc-nogame-es-light");
});

test("arrastrar con el raton mueve un Pokémon del equipo a una caja y se puede deshacer", async ({ page }) => {
  env = await setup(page);
  const lay = await layout(env);
  await openSave(page, env);
  await goToBox(page, lay.filledBox);

  await expect(page.getByTestId("pc-party").locator("[data-ref]")).toHaveCount(6);
  await drag(page, "party/5", lay.empty[0]);
  await expect(page.getByTestId("pc-party").locator("[data-ref]")).toHaveCount(5);
  await expect(page.getByTestId("pc-box").locator("[data-ref]")).toHaveCount(lay.filled.length + 1);
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
  await shot(page, "93-pc-moved-es-light");

  // Y de vuelta al final del equipo (casilla vacia party/5).
  await drag(page, lay.empty[0], "party/5");
  await expect(page.getByTestId("pc-party").locator("[data-ref]")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Cambios 2" })).toBeVisible();

  await page.getByRole("button", { name: "Cambios 2" }).click();
  await page.getByRole("button", { name: "Deshacer todo" }).click();
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await expect(page.getByTestId("pc-party").locator("[data-ref]")).toHaveCount(6);
  await expect(page.getByTestId("pc-box").locator("[data-ref]")).toHaveCount(lay.filled.length);
});

test("intercambiar dos casillas ocupadas y soltar sobre la misma no cambia nada", async ({ page }) => {
  env = await setup(page);
  const lay = await layout(env);
  test.skip(lay.filled.length < 2, "la caja de pruebas necesita dos Pokémon");
  await openSave(page, env);
  await goToBox(page, lay.filledBox);
  const nameOf = async (cell: string) => page.locator(`[data-cell="${cell}"]`).getAttribute("aria-label");
  const [a, b] = lay.filled;
  const [na, nb] = [await nameOf(a), await nameOf(b)];
  await drag(page, a, b);
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
  await expect(page.locator(`[data-cell="${a}"]`)).toHaveAttribute("aria-label", nb!);
  await expect(page.locator(`[data-cell="${b}"]`)).toHaveAttribute("aria-label", na!);
  // soltar sobre la propia casilla: sin cambios nuevos
  await drag(page, a, a);
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
});

test("teclado: Espacio agarra, las flechas mueven y Espacio suelta", async ({ page }) => {
  env = await setup(page);
  const lay = await layout(env);
  await openSave(page, env);
  await goToBox(page, lay.filledBox);
  const src = lay.filled[0];
  const target = `box/${lay.filledBox}/${Number(src.split("/")[2]) === 29 ? 28 : Number(src.split("/")[2]) + 1}`;
  const targetWasEmpty = lay.empty.includes(target);

  await page.locator(`[data-cell="${src}"]`).focus();
  await page.keyboard.press("Space");
  await expect(page.getByText(/Pokémon agarrado/)).toBeVisible();
  await page.keyboard.press(Number(src.split("/")[2]) === 29 ? "ArrowLeft" : "ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
  if (targetWasEmpty) await expect(page.locator(`[data-cell="${src}"]`)).not.toHaveAttribute("data-ref", /.+/);
  await expect(page.getByText(/movido a/)).toBeAttached();

  // Esc cancela un agarre
  await page.locator(`[data-cell="${target}"]`).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Escape");
  await expect(page.getByText(/Pokémon agarrado/)).toHaveCount(0);
});

test("el equipo no se vacía y no pasa de seis; liberar pide confirmación", async ({ page }) => {
  env = await setup(page);
  const lay = await layout(env);
  await openSave(page, env);
  await goToBox(page, lay.filledBox);

  // Equipo lleno: no hay casilla de destino extra; soltar un Pokemon de la caja sobre un miembro intercambia.
  await expect(page.locator('[data-cell="party/6"]')).toHaveCount(0);

  await page.getByTestId("pc-box").locator(`[data-cell="${lay.filled[0]}"]`).click();
  await page.getByRole("button", { name: "Liberar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await shot(page, "94-pc-release-es-light");
  await dialog.getByRole("button", { name: "Liberar" }).click();
  await expect(page.getByTestId("pc-box").locator("[data-ref]")).toHaveCount(lay.filled.length - 1);
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
});

test("Equipo: rejilla grande, intercambio por arrastre y capturas en inglés y oscuro", async ({ page }) => {
  env = await setup(page);
  await layout(env);
  await serveGameAssets(page);
  await openSave(page, env);
  await linkGame(page, env);
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  const grid = page.getByTestId("pc-party");
  await expect(grid.locator("[data-ref]")).toHaveCount(6);
  const first = await grid.locator('[data-cell="party/0"]').getAttribute("aria-label");
  const fourth = await grid.locator('[data-cell="party/3"]').getAttribute("aria-label");
  await drag(page, "party/0", "party/3");
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
  await expect(grid.locator('[data-cell="party/0"]')).toHaveAttribute("aria-label", fourth!);
  await expect(grid.locator('[data-cell="party/3"]')).toHaveAttribute("aria-label", first!);
  await shot(page, "95-party-es-light");

  await page.getByRole("button", { name: /^Tema/ }).click();
  await page.getByRole("button", { name: /^Tema/ }).click();
  await page.getByRole("button", { name: "EN" }).first().click();
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await shot(page, "96-pc-en-dark");
});
