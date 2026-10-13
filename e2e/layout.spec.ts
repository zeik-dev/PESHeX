import { expect, test } from "@playwright/test";
import { openSave, setMode, setup, shot, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

/** Alto de un elemento medido en pantalla (el h1 oculto mide 1 px). */
const visibleHeight = (page: import("@playwright/test").Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().height);

test("ninguna vista pinta un título de página: lo indica la pestaña activa", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  for (const name of ["Resumen", "Entrenador", "Equipo", "PC", "Mochila", "Pokédex", "Mundo", "Todo detectado", "Copias", "Cambios", "Avanzado", "Ajustes"]) {
    await page.getByRole("button", { name, exact: true }).click();
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1); // sigue existiendo para lectores de pantalla
    expect(await visibleHeight(page, "main h1"), `${name}: el h1 no ocupa espacio`).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", /.*/).catch(() => undefined);
  }
});

test("PC: la página no scrollea y el panel de datos es el único scroll", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.locator('[data-cell="party/0"]').click();
  const info = page.getByTestId("pc-info");
  await expect(info).toBeVisible();

  const main = page.locator("main");
  const m = await main.evaluate((el) => ({ over: getComputedStyle(el).overflowY, sh: el.scrollHeight, ch: el.clientHeight }));
  expect(m.over).toBe("hidden");
  expect(m.sh).toBeLessThanOrEqual(m.ch + 1);
  expect(await info.evaluate((el) => getComputedStyle(el).overflowY)).toBe("auto");

  // La caja entera y el equipo caben a la vista (sin scroll de página) en 1280×820.
  const box = await page.locator('[data-cell="box/0/0"]').boundingBox();
  const last = await page.locator('[data-cell="box/0/29"]').boundingBox();
  expect(box && last && last.y + last.height <= 820).toBeTruthy();

  // Botones principales del panel: Editar, Clonar y Liberar; el resto, dentro de «Acciones rápidas».
  for (const name of ["Editar", "Clonar", "Liberar"]) await expect(info.getByRole("button", { name })).toBeVisible();
  await expect(info.getByRole("button", { name: "Curar", exact: true })).toHaveCount(0);
  await shot(page, "layout-pc");
});

test("«Acciones rápidas» se abre hacia la izquierda y lleva curar, IV, recalcular, presets y exportar", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await page.locator('[data-cell="party/0"]').click();
  const trigger = page.getByTestId("pc-info").getByRole("button", { name: /Acciones rápidas/ });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const pop = page.getByRole("dialog", { name: "Acciones rápidas" });
  await expect(pop).toBeVisible();
  const a = (await trigger.boundingBox())!;
  const b = (await pop.boundingBox())!;
  expect(b.x + b.width, "el desplegable queda a la izquierda del botón").toBeLessThanOrEqual(a.x + 1);
  for (const name of ["Curar", "IV al máximo", "Recalcular estadísticas", "Exportar…"]) await expect(pop.getByRole("button", { name })).toBeVisible();
  await expect(pop.getByTestId("ev-presets")).toBeVisible();
  await shot(page, "layout-acciones");
  await page.keyboard.press("Escape");
  await expect(pop).toHaveCount(0);
  await expect(page.getByTestId("pc-info")).toBeVisible();
});

test("etiqueta de total e interruptor de ilegales bajo el equipo; el interruptor solo existe en HeX", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await page.getByRole("button", { name: "PC", exact: true }).click();
  const tray = page.getByTestId("pc-party");
  await expect(page.getByTestId("pc-total")).toBeVisible();
  const trayBox = (await tray.boundingBox())!;
  expect((await page.getByTestId("pc-total").boundingBox())!.y).toBeGreaterThanOrEqual(trayBox.y + trayBox.height - 1);
  await expect(page.getByRole("switch", { name: "Solo ilegales" })).toHaveCount(0);

  await setMode(page, "hex");
  const sw = page.getByRole("switch", { name: "Solo ilegales" });
  await expect(sw).toBeVisible();
  expect((await sw.boundingBox())!.y).toBeGreaterThanOrEqual(trayBox.y + trayBox.height - 1);
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Solo ilegales" })).toBeVisible();
  await shot(page, "layout-equipo-hex");
});
