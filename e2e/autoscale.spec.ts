// Escala automática: con ella TODAS las pestañas del encabezado se ven sin scroll y la escala sigue al tamaño de la ventana.
// `ZoomEmulator` reproduce el zoom nativo del WebView (viewport CSS = físico / zoom) para poder medirlo en Chromium.
import { expect, test, type Page } from "@playwright/test";
import { openSave, setup, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const nav = (page: Page) => page.getByRole("navigation", { name: "Principal" });

/** ¿Caben todas las pestañas sin scroll horizontal? */
const noScroll = async (page: Page) => nav(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
const lastZoom = () => env!.bridge.zoomCalls.at(-1) ?? 1;

async function settled(page: Page) {
  await expect.poll(() => noScroll(page), { timeout: 10_000 }).toBe(true);
  // la escala deja de cambiar (el ajuste converge en 1-3 pasadas)
  let prev = -1;
  await expect.poll(async () => {
    const z = lastZoom();
    const stable = z === prev;
    prev = z;
    return stable;
  }, { timeout: 10_000, intervals: [300] }).toBe(true);
}

test("por defecto la escala es automática y las 12 pestañas caben sin scroll", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await settled(page);
  expect(lastZoom(), "a 1280 px las pestañas no caben a 100 %: se reduce").toBeLessThan(1);
  expect(lastZoom()).toBeGreaterThan(0.8);
  await expect(nav(page).getByRole("button")).toHaveCount(12);
});

test("al redimensionar o maximizar la ventana la escala se reajusta (crece y se reduce) y siempre caben las pestañas", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await settled(page);
  const base = lastZoom();

  await env.window.resize(900, 600); // el mínimo de la ventana
  await settled(page);
  const small = lastZoom();
  expect(small, "más pequeña la ventana, más pequeña la escala").toBeLessThan(base);
  expect(small).toBeGreaterThanOrEqual(0.5);

  await env.window.resize(1920, 1080); // maximizada en una pantalla Full HD
  await settled(page);
  const big = lastZoom();
  expect(big, "más grande la ventana, más grande la escala (proporcional, no solo el zoom fijo)").toBeGreaterThan(base);

  // El alto también cuenta: una ventana muy ancha pero baja no crece más de lo que permite su alto.
  await env.window.resize(1920, 560);
  await settled(page);
  expect(lastZoom()).toBeLessThan(big);

  await env.window.resize(1100, 720); // vuelve al tamaño por defecto de la ventana
  await settled(page);
  expect(Math.abs(lastZoom() - small)).toBeGreaterThan(0.01);
});

test("con el zoom en manual la escala no sigue a la ventana y se puede volver a automático", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await settled(page);
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  const card = page.locator("section", { has: page.getByRole("heading", { name: "Zoom de la aplicación" }) });
  const auto = card.getByRole("switch", { name: "Automático (ajustar a la ventana)" });
  await expect(auto).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("slider")).toBeDisabled();

  await auto.click(); // a manual: parte de lo que se veía
  await expect(auto).toHaveAttribute("aria-checked", "false");
  await expect(card.getByRole("slider")).toBeEnabled();
  const manual = lastZoom();
  await env.window.resize(1920, 1080);
  await page.waitForTimeout(600);
  expect(lastZoom(), "en manual el redimensionado no cambia la escala").toBe(manual);

  await auto.click(); // de vuelta a automático
  await expect.poll(() => lastZoom(), { timeout: 10_000 }).toBeGreaterThan(manual);
  await expect(card.getByTestId("zoom-value")).toHaveText(/^\d+ %$/);
});
