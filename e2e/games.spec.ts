// «Mis juegos»: biblioteca de fangames con Save Scan (las partidas de cada juego, sin copias .bak), carpeta de guardados elegida
// a mano, precarga con progreso y vinculación automática de las partidas de un juego registrado.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { buildFakeGame } from "./support/fakegame";
import { ROOT, serveGameAssets, setup, shot, silenceGamePrompt, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const library = (page: Page) => page.getByTestId("game-library");

/** Copia el save de la prueba (un Marshal válido) a `file`, creando la carpeta. */
function putSave(e: Env, file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(e.savePath, file);
}

async function start(page: Page) {
  env = await setup(page, "Partida_2.rxdata", { gamePrompt: true });
  await serveGameAssets(page);
  // Sin asistente de primer arranque (tiene su propia prueba) y SIN «No volver a preguntar»: si la biblioteca no vinculara el
  // juego, saldría el aviso de la carpeta del juego.
  await silenceGamePrompt(page, null, "es");
  const game = buildFakeGame(ROOT, path.join(env.workDir, "Mi Juego"), env.savePath, {});
  env.bridge.dialogDir = game.root;
  await page.goto("/");
  return game;
}

async function addGame(page: Page) {
  await library(page).getByRole("button", { name: "Agregar directorio de juego" }).click();
  await expect(page.getByTestId("game-card")).toHaveCount(1);
}

test("sin juegos la pantalla de inicio lo explica y «Agregar directorio de juego» registra el juego", async ({ page }) => {
  await start(page);
  await expect(library(page).getByText(/Aún no has agregado ningún juego/)).toBeVisible();
  await addGame(page);
  const card = page.getByTestId("game-card");
  await expect(card).toContainText("Fixture Game"); // el título de Game.ini
  await expect(card.getByText("Sin partidas")).toBeVisible();
  await expect(library(page).getByText(/Aún no has agregado/)).toHaveCount(0);
  await shot(page, "160-games-empty-es-light");
});

test("el Save Scan encuentra las partidas (varias en la misma carpeta) e ignora las copias .bak y los temporales", async ({ page }) => {
  const game = await start(page);
  putSave(env!, path.join(game.root, "Saves", "Game.rxdata"));
  putSave(env!, path.join(game.root, "Saves", "Game2.rxdata"));
  // Copias de seguridad con el nombre de CADA partida, el temporal de PESHeX y un archivo que no es una partida
  putSave(env!, path.join(game.root, "Saves", "Game.rxdata.20261015-120000.bak"));
  putSave(env!, path.join(game.root, "Saves", "Game2.rxdata.20261015-120001.bak"));
  putSave(env!, path.join(game.root, "Saves", "Game2.rxdata.tmp-123"));
  fs.writeFileSync(path.join(game.root, "Saves", "notas.rxdata"), "no soy un Marshal, solo texto largo ".repeat(5));

  await addGame(page);
  const card = page.getByTestId("game-card");
  await expect(card.getByText("2 partidas")).toBeVisible();
  const saves = card.getByRole("listitem");
  await expect(saves).toHaveCount(2);
  await expect(saves.nth(0)).toContainText(/Game2?\.rxdata/);
  await expect(card.getByText(/\.bak|\.tmp/)).toHaveCount(0);
  await expect(card.getByText(/notas/)).toHaveCount(0);
  await shot(page, "161-games-saves-es-light");
});

test("abrir una partida desde «Mis juegos» la abre y vincula el juego sin preguntar, y el juego sube al principio", async ({ page }) => {
  const game = await start(page);
  // El save vive FUERA del juego (como %APPDATA%\<Título>\ en Essentials v19+): el motor no puede adivinar su carpeta.
  const appData = path.join(env!.workDir, "AppData");
  env!.bridge.games.appDataDirs = [appData];
  putSave(env!, path.join(appData, "Fixture Game", "Game.rxdata"));
  await addGame(page);
  const card = page.getByTestId("game-card");
  await expect(card.getByText("1 partida", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Abrir la partida Game.rxdata" }).click();
  await expect(page.getByText("Furikita").first()).toBeVisible({ timeout: 30_000 });
  // Sin aviso de «carpeta del juego»: el juego registrado se vinculó solo.
  await expect(page.getByRole("dialog", { name: "Carpeta del juego" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await expect(page.getByText("Datos completos")).toBeVisible({ timeout: 30_000 });
  expect(game.root).toBeTruthy();
});

test("si el escaneo no encuentra las partidas se elige la carpeta de guardados a mano y se puede quitar", async ({ page }) => {
  await start(page);
  await addGame(page);
  const card = page.getByTestId("game-card");
  await expect(card.getByText("Sin partidas")).toBeVisible();
  await expect(card.getByText(/No se encontraron partidas de este juego/)).toBeVisible();

  const elsewhere = path.join(env!.workDir, "Mis Partidas");
  putSave(env!, path.join(elsewhere, "Aventura.rxdata"));
  env!.bridge.dialogDir = elsewhere;
  await card.getByRole("button", { name: "Elegir carpeta de guardados…" }).click();
  await expect(card.getByText("1 partida", { exact: true })).toBeVisible();
  await expect(card.getByRole("listitem")).toContainText("Aventura.rxdata");
  await expect(card.getByText("Carpetas elegidas a mano")).toBeVisible();
  await shot(page, "162-games-manual-dir-es-light");

  await card.getByRole("button", { name: /^Quitar la carpeta/ }).click();
  await expect(card.getByText("Sin partidas")).toBeVisible();
  await expect(card.getByText("Carpetas elegidas a mano")).toHaveCount(0);
});

test("«Precargar» lee los datos del juego con progreso real y deja el juego marcado como precargado", async ({ page }) => {
  await start(page);
  env!.bridge.stepDelayMs = 300; // para poder ver avanzar la barra
  await addGame(page);
  const card = page.getByTestId("game-card");
  await card.getByRole("button", { name: "Precargar" }).click();
  const bar = card.getByRole("progressbar");
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("aria-valuetext", /Leyendo|Indexando/);
  await expect(card.getByTestId("game-progress-hint")).toHaveText(/puede tardar varios minutos/);
  await expect(card.getByRole("button", { name: "Precargando…" })).toBeDisabled();
  const seen = new Set<string>();
  await expect
    .poll(async () => {
      const v = await bar.getAttribute("aria-valuenow", { timeout: 200 }).catch(() => null);
      if (v) seen.add(v);
      return await card.getByText("Precargado", { exact: true }).count();
    }, { timeout: 60_000, intervals: [100] })
    .toBe(1);
  expect(seen.size, "la barra pasa por varios valores intermedios").toBeGreaterThan(2);
  await expect(bar).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Precargar" })).toBeEnabled();
});

test("quitar un juego de la lista no borra nada y Ajustes gestiona la misma lista (sin botones de abrir)", async ({ page }) => {
  const game = await start(page);
  const own = path.join(game.root, "Saves", "Game.rxdata");
  putSave(env!, own);
  await addGame(page);
  // Abrir una partida DEL juego registrado (se vincula sola) para llegar a Ajustes
  env!.bridge.dialogPath = own;
  await page.getByRole("button", { name: "Abrir partida…" }).click();
  await expect(page.getByText("Furikita").first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  const settingsLibrary = library(page);
  await expect(settingsLibrary.getByTestId("game-card")).toHaveCount(1);
  // En Ajustes las tarjetas empiezan plegadas; al desplegarla se ven las partidas pero SIN botones de abrir.
  await settingsLibrary.getByRole("button", { name: /^Mostrar los detalles de/ }).click();
  await expect(settingsLibrary.getByText("Game.rxdata").first()).toBeVisible();
  await expect(settingsLibrary.getByRole("button", { name: /^Abrir la partida/ })).toHaveCount(0);

  await settingsLibrary.getByTestId("game-card").getByRole("button", { name: "Quitar de la lista" }).click();
  await expect(settingsLibrary.getByTestId("game-card")).toHaveCount(0);
  expect(fs.existsSync(path.join(game.root, "Saves", "Game.rxdata")), "no se borra nada del disco").toBe(true);
});

test("primer arranque: el asistente ofrece agregar un directorio de juego tras elegir el idioma", async ({ page }) => {
  env = await setup(page, "Partida_2.rxdata", { gamePrompt: true });
  await serveGameAssets(page);
  const game = buildFakeGame(ROOT, path.join(env.workDir, "Mi Juego"), env.savePath, {});
  env.bridge.dialogDir = game.root;
  await page.goto("/");
  const wizard = page.getByRole("dialog", { name: "Te damos la bienvenida a PESHeX" });
  await expect(wizard).toBeVisible();
  await wizard.getByRole("button", { name: "Continuar" }).click();
  const step2 = page.getByRole("dialog", { name: "¿Quieres agregar un directorio de juego?" });
  await expect(step2).toBeVisible();
  await shot(page, "163-first-run-game-es-light");
  await step2.getByRole("button", { name: "Agregar directorio de juego…" }).click();
  await expect(step2.getByTestId("first-run-added")).toContainText("Fixture Game");
  await step2.getByRole("button", { name: "Empezar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // El juego quedó en «Mis juegos»
  await expect(page.getByTestId("game-card")).toHaveCount(1);
});

test("primer arranque: «Ahora no» termina el asistente sin registrar nada", async ({ page }) => {
  env = await setup(page, "Partida_2.rxdata", { gamePrompt: true });
  await page.goto("/");
  await page.getByRole("dialog", { name: "Te damos la bienvenida a PESHeX" }).getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("dialog", { name: "¿Quieres agregar un directorio de juego?" }).getByRole("button", { name: "Ahora no" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("game-card")).toHaveCount(0);
});
