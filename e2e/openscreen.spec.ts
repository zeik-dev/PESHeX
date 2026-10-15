// Pantalla de inicio: una sola tarjeta SIN scroll de página, con dos tabs («Partidas recientes» / «Juegos guardados») cuyo panel
// hace scroll por dentro cuando hay muchos elementos.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { setup, shot, silenceGamePrompt, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const tabs = (page: Page) => page.getByTestId("open-tabs");
const panel = (page: Page) => page.getByTestId("open-panel");
const tab = (page: Page, name: string) => tabs(page).getByRole("tab", { name });

/** Registra `n` juegos (cada uno con 2 partidas) en la biblioteca simulada, como si ya estuvieran agregados. */
function registerGames(e: Env, n: number) {
  for (let i = 0; i < n; i++) {
    const dir = path.join(e.workDir, `Juego ${i + 1}`);
    fs.mkdirSync(path.join(dir, "Data"), { recursive: true });
    fs.mkdirSync(path.join(dir, "Graphics"), { recursive: true });
    fs.mkdirSync(path.join(dir, "Saves"), { recursive: true });
    fs.writeFileSync(path.join(dir, "Game.ini"), `[Game]\nTitle=Juego número ${i + 1}\n`);
    for (const f of ["Game.rxdata", "Game2.rxdata"]) fs.copyFileSync(e.savePath, path.join(dir, "Saves", f));
    e.bridge.games.add(dir);
  }
}

/** Añade `n` partidas recientes (rutas inventadas salvo la primera, que es el save real) a los ajustes antes de cargar la app. */
async function seedRecent(page: Page, paths: string[]) {
  await page.addInitScript((recent) => {
    const k = "peshex-settings";
    const cur = JSON.parse(localStorage.getItem(k) ?? "{}");
    localStorage.setItem(k, JSON.stringify({ ...cur, state: { ...cur.state, recent } }));
  }, paths);
}

/** ¿La página (no el panel) hace scroll? */
const pageScrolls = (page: Page) =>
  page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    const openPage = document.querySelector<HTMLElement>('[class*="openPage"]');
    return {
      doc: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
      openPage: !!openPage && openPage.scrollHeight > openPage.clientHeight + 1,
    };
  });

test("sin recientes ni juegos entra en «Juegos guardados», con el botón de agregar, y no hay scroll", async ({ page }) => {
  env = await setup(page);
  await silenceGamePrompt(page, null, "es");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Abre una partida" })).toBeVisible();
  await expect(tab(page, /Juegos guardados/)).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, /Partidas recientes/)).toHaveAttribute("aria-selected", "false");
  await expect(panel(page).getByRole("button", { name: "Agregar directorio de juego" })).toBeVisible();
  await expect(page.getByText(/Aún no has agregado ningún juego/)).toBeVisible();
  expect(await pageScrolls(page)).toEqual({ doc: false, openPage: false });
  await shot(page, "176-open-tabs-empty-es-light");
});

test("con recientes entra en «Partidas recientes»; abrir una y quitar otra", async ({ page }) => {
  env = await setup(page);
  await silenceGamePrompt(page, env.savePath, "es");
  await seedRecent(page, [env.savePath, "/no/existe/Otra partida.rxdata"]);
  await page.goto("/");
  await expect(tab(page, /Partidas recientes/)).toHaveAttribute("aria-selected", "true");
  await expect(tab(page, /Partidas recientes/)).toContainText("2"); // el conteo
  const items = panel(page).getByRole("button", { name: /rxdata/ });
  await expect(items).toHaveCount(2);

  // Quitar una de la lista no la abre ni toca el disco
  await panel(page).getByRole("button", { name: "Quitar", exact: true }).nth(1).click();
  await expect(items).toHaveCount(1);
  await expect(tab(page, /Partidas recientes/)).toContainText("1");

  await items.first().click();
  await expect(page.getByText("Furikita").first()).toBeVisible({ timeout: 20_000 });
});

test("sin recientes (todas quitadas) el tab explica que aparecerán aquí", async ({ page }) => {
  env = await setup(page);
  await silenceGamePrompt(page, null, "es");
  await seedRecent(page, ["/x/Una.rxdata"]);
  await page.goto("/");
  await panel(page).getByRole("button", { name: "Quitar", exact: true }).click();
  await expect(page.getByTestId("recent-empty")).toContainText("Aún no has abierto ninguna partida");
});

test("los tabs se cambian con clic y con el teclado (flechas, Inicio y Fin) y el panel sigue al tab", async ({ page }) => {
  env = await setup(page);
  registerGames(env, 2);
  await silenceGamePrompt(page, null, "es");
  await seedRecent(page, ["/x/Una.rxdata"]);
  await page.goto("/");
  const recent = tab(page, /Partidas recientes/);
  const games = tab(page, /Juegos guardados/);
  await expect(recent).toHaveAttribute("aria-selected", "true");
  await expect(games).toContainText("2");
  // El panel está enlazado al tab (accesibilidad)
  await expect(panel(page)).toHaveAttribute("aria-labelledby", /open-tab-recent/);
  await expect(recent).toHaveAttribute("aria-controls", /open-panel-recent/);

  await games.click();
  await expect(games).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("game-library")).toBeVisible();
  await expect(panel(page)).toHaveAttribute("aria-labelledby", /open-tab-games/);

  await games.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(recent).toHaveAttribute("aria-selected", "true");
  await expect(recent).toBeFocused();
  await page.keyboard.press("End");
  await expect(games).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(recent).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(games).toBeFocused();
  // Solo el tab activo está en el orden de tabulación
  await expect(recent).toHaveAttribute("tabindex", "-1");
  await expect(games).toHaveAttribute("tabindex", "0");
});

test("abrir una partida desde «Juegos guardados» la abre (con el juego ya registrado, sin preguntar)", async ({ page }) => {
  env = await setup(page);
  registerGames(env, 1);
  await silenceGamePrompt(page, null, "es");
  await page.goto("/");
  await expect(tab(page, /Juegos guardados/)).toHaveAttribute("aria-selected", "true");
  await panel(page).getByRole("button", { name: "Abrir la partida Game.rxdata" }).click();
  await expect(page.getByText("Furikita").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("dialog", { name: "Carpeta del juego" })).toHaveCount(0);
});

test("con muchos recientes y juegos nunca hay scroll de página (900×600, 1280×820 y 1920×1080); el panel hace scroll por dentro", async ({ page }) => {
  env = await setup(page);
  registerGames(env, 6);
  await silenceGamePrompt(page, null, "es");
  await seedRecent(page, Array.from({ length: 12 }, (_, i) => `/partidas/muy/larga/ruta/de/prueba/Partida ${i + 1}.rxdata`));
  await page.goto("/");
  await expect(tab(page, /Partidas recientes/)).toHaveAttribute("aria-selected", "true");

  for (const [w, h] of [[900, 600], [1280, 820], [1920, 1080]] as const) {
    await env.window.resize(w, h);
    for (const name of [/Partidas recientes/, /Juegos guardados/]) {
      await tab(page, name).click();
      await page.waitForTimeout(350); // el auto-zoom converge
      expect(await pageScrolls(page), `${w}×${h} ${String(name)}`).toEqual({ doc: false, openPage: false });
      // Todo lo importante cabe en la ventana: botón de abrir, tabs, panel y pie
      const inView = async (loc: ReturnType<Page["getByRole"]>) => {
        const box = await loc.boundingBox();
        const vh = await page.evaluate(() => window.innerHeight);
        expect(box, `${w}×${h}`).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(-1);
        expect(box!.y + box!.height).toBeLessThanOrEqual(vh + 1);
      };
      await inView(page.getByRole("button", { name: "Abrir partida…" }));
      await inView(tabs(page).getByRole("tablist"));
      await inView(page.getByText(/Compatible con Essentials/));
      const p = await panel(page).boundingBox();
      expect(p!.height, `el panel conserva un alto útil a ${w}×${h}`).toBeGreaterThanOrEqual(90);
    }
  }
  // A 900×600 la lista de 12 recientes no cabe: el panel es el que desplaza
  await env.window.resize(900, 600);
  await tab(page, /Partidas recientes/).click();
  await page.waitForTimeout(350);
  expect(await panel(page).evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
  await shot(page, "177-open-tabs-recent-es-light");
});

test("el caso más ajustado (alto de 700 px CSS, zoom 100 %) también cabe sin scroll y el panel conserva un alto útil", async ({ page }) => {
  env = await setup(page, "Partida_2.rxdata", { manualZoom: 100 }); // sin la escala automática: viewport real = el de Playwright
  registerGames(env, 6);
  await silenceGamePrompt(page, null, "es", 100);
  await seedRecent(page, Array.from({ length: 12 }, (_, i) => `/partidas/muy/larga/ruta/de/prueba/Partida ${i + 1}.rxdata`));
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto("/");
  for (const [name, file] of [[/Partidas recientes/, "179-open-700-recent-es-light"], [/Juegos guardados/, "180-open-700-games-es-light"]] as const) {
    await tab(page, name).click();
    await page.waitForTimeout(250);
    expect(await pageScrolls(page)).toEqual({ doc: false, openPage: false });
    const p = await panel(page).boundingBox();
    expect(p!.height).toBeGreaterThanOrEqual(90);
    const foot = await page.getByText(/Compatible con Essentials/).boundingBox();
    expect(foot!.y + foot!.height).toBeLessThanOrEqual(700 + 1);
    await shot(page, file);
  }
});

test("English: tabs translated", async ({ page }) => {
  env = await setup(page);
  registerGames(env, 1);
  await silenceGamePrompt(page, null, "en");
  await seedRecent(page, ["/x/One.rxdata"]);
  await page.goto("/");
  await expect(tab(page, /Recent saves/)).toHaveAttribute("aria-selected", "true");
  await tab(page, /Saved games/).click();
  await expect(panel(page).getByRole("button", { name: "Add game folder" }).or(panel(page).getByRole("button", { name: /Add .*game/i }))).toBeVisible();
  await shot(page, "178-open-tabs-games-en-light");
});
