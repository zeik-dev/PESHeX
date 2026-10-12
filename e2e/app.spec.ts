import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DriverBridge, TAURI_MOCK } from "./support/bridge";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = path.join(ROOT, "e2e", "screenshots");

let bridge: DriverBridge;
let workDir: string;
let savePath: string;

test.beforeAll(() => {
  fs.mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  // Cada test trabaja sobre una copia: nunca se toca test_saves/.
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "peshex-e2e-"));
  savePath = path.join(workDir, "Partida_2.rxdata");
  fs.copyFileSync(path.join(ROOT, "test_saves", "Partida_2.rxdata"), savePath);

  bridge = new DriverBridge(ROOT);
  bridge.dialogPath = savePath;
  await page.exposeFunction("__pwInvoke", (cmd: string, args: Record<string, unknown>) => bridge.handle(cmd, args));
  await page.addInitScript(TAURI_MOCK);
  await page.addInitScript(() => localStorage.clear());
});

test.afterEach(async () => {
  await bridge.dispose();
  fs.rmSync(workDir, { recursive: true, force: true });
});

async function openSave(page: Page, lang: "es" | "en" = "es", expected = "Furikita") {
  bridge.locale = lang === "es" ? "es-ES" : "en-US";
  await page.addInitScript((l) => {
    Object.defineProperty(navigator, "languages", { get: () => [l === "es" ? "es-ES" : "en-US"] });
    Object.defineProperty(navigator, "language", { get: () => (l === "es" ? "es-ES" : "en-US") });
  }, lang);
  await page.goto("/");
  await page.getByRole("button", { name: lang === "es" ? "Abrir partida…" : "Open save…" }).click();
  await expect(page.getByText(expected).first()).toBeVisible({ timeout: 20_000 });
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

test("pantalla de apertura bilingue", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["es-ES"] });
    Object.defineProperty(navigator, "language", { get: () => "es-ES" });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Abre una partida" })).toBeVisible();
  await shot(page, "01-open-es-light");
  await page.getByRole("button", { name: "EN" }).first().click();
  await expect(page.getByRole("heading", { name: "Open a save file" })).toBeVisible();
  await shot(page, "02-open-en-light");
});

test("resumen detecta la base y muestra al entrenador y su equipo", async ({ page }) => {
  await openSave(page);
  await expect(page.getByText("Pokémon Essentials v19–v21").first()).toBeVisible();
  await expect(page.getByText("Confianza alta").first()).toBeVisible();
  await expect(page.getByText("₽26.350")).toBeVisible();
  await expect(page.getByText("Trump").first()).toBeVisible();
  await shot(page, "03-overview-es-light");
});

test("recorre todas las pestañas en español e inglés, claro y oscuro", async ({ page }) => {
  await openSave(page, "es");
  const tabs = ["Entrenador", "Equipo", "PC", "Mochila", "Todo detectado", "Cambios", "Ajustes"];
  for (const [i, name] of tabs.entries()) {
    await page.getByRole("button", { name, exact: true }).click();
    await shot(page, `10-tab-${i}-${name.toLowerCase().replace(/\s+/g, "-")}-es-light`);
  }
  // Modo oscuro + ingles
  await page.getByRole("button", { name: /^Tema/ }).click(); // auto -> claro
  await page.getByRole("button", { name: /^Tema/ }).click(); // claro -> oscuro
  await page.getByRole("button", { name: "EN" }).first().click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByText("Detected base").first()).toBeVisible();
  await shot(page, "20-overview-en-dark");
  for (const name of ["Trainer", "Party", "PC", "Bag", "Everything found"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await shot(page, `21-tab-${name.toLowerCase().replace(/\s+/g, "-")}-en-dark`);
  }
});

test("editar dinero, ver el cambio pendiente y deshacerlo", async ({ page }) => {
  await openSave(page);
  await page.getByRole("button", { name: "Entrenador", exact: true }).click();
  const money = page.getByLabel("Dinero");
  await money.fill("5000");
  await money.press("Enter");
  await expect(page.getByRole("button", { name: "Cambios 1" })).toBeVisible();
  await page.getByRole("button", { name: "Cambios 1" }).click();
  await expect(page.getByText("Editar entrenador: money")).toBeVisible();
  await shot(page, "30-changes-es-light");
  await page.getByRole("button", { name: "Deshacer el último" }).click();
  await expect(page.getByText("No hay cambios pendientes.")).toBeVisible();
  await page.getByRole("button", { name: "Entrenador", exact: true }).click();
  await expect(page.getByLabel("Dinero")).toHaveValue("26350");
});

test("valor fuera de rango pide confirmacion", async ({ page }) => {
  await openSave(page);
  await page.getByRole("button", { name: "Entrenador", exact: true }).click();
  const money = page.getByLabel("Dinero");
  await money.fill("99999999");
  await money.press("Enter");
  await expect(page.getByRole("dialog", { name: "Valores fuera de lo habitual" })).toBeVisible();
  await shot(page, "31-confirm-es-light");
  await page.getByRole("button", { name: "Aplicar de todos modos" }).click();
  await expect(page.getByLabel("Dinero")).toHaveValue("99999999");
});

test("editor de Pokémon: IV perfectos, movimientos y guardado real", async ({ page }) => {
  await openSave(page);
  await page.getByRole("button", { name: "Equipo", exact: true }).click();
  await page.getByRole("button", { name: /^Trump/ }).click();
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Gumshoos").first()).toBeVisible();
  await shot(page, "40-pokemon-general-es-light");
  await drawer.getByRole("tab", { name: "IV y EV" }).click();
  await drawer.getByRole("button", { name: "IV perfectos (31)" }).click();
  await expect(drawer.getByRole("textbox", { name: "IV PS" })).toHaveValue("31");
  await shot(page, "41-pokemon-stats-es-light");
  await drawer.getByRole("tab", { name: /Movimientos/ }).click();
  await shot(page, "42-pokemon-moves-es-light");
  await drawer.getByRole("tab", { name: "Información" }).click();
  await shot(page, "43-pokemon-info-es-light");

  // Guardar con el boton central de la cabecera y verificar en el archivo.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Partida guardada.")).toBeVisible();
  const verify = new DriverBridge(ROOT);
  try {
    await verify.handle("open_save", { path: savePath });
    const res = (await verify.handle("driver_call", { cmd: "get_pokemon", params: { ref: "party/0" } })) as { value: { pokemon: { iv: Record<string, number> } } };
    expect(Object.values(res.value.pokemon.iv).every((v) => v === 31)).toBe(true);
  } finally {
    await verify.dispose();
  }
});

test("mochila: añadir un objeto y ver el PC", async ({ page }) => {
  await openSave(page);
  await page.getByRole("button", { name: "Mochila", exact: true }).click();
  await page.getByRole("tab", { name: /Poké Balls/ }).click();
  await page.getByLabel("ID interno del objeto").fill("ultraball");
  await page.getByRole("button", { name: "Añadir", exact: true }).click();
  await expect(page.getByText("Ultraball").first()).toBeVisible();
  await shot(page, "50-bag-es-light");
  await page.getByRole("button", { name: "PC", exact: true }).click();
  await shot(page, "51-boxes-es-light");
});

test("avanzado construye el indice y localiza un campo", async ({ page }) => {
  await openSave(page);
  await page.getByRole("button", { name: "Avanzado", exact: true }).click();
  await expect(page.getByText(/\d+ campos/).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "60-advanced-es-light");
});

test("base antigua v16-v18 (sintetica): detecta el perfil y edita con ids numericos", async ({ page }) => {
  const legacy = path.join(workDir, "Game.rxdata");
  execFileSync("ruby", ["-r", path.join(ROOT, "test", "fixtures", "make_legacy_save.rb"), "-e", "File.binwrite(ARGV[0], LegacyFixture.build)", legacy]);
  bridge.dialogPath = legacy;
  await openSave(page, "es", "Red");
  await expect(page.getByText("Pokémon Essentials v16–v18").first()).toBeVisible();
  await expect(page.getByText("Sparky").first()).toBeVisible();
  await shot(page, "70-legacy-overview-es-light");
  await page.getByRole("button", { name: "Entrenador", exact: true }).click();
  const money = page.getByLabel("Dinero");
  await money.fill("9999");
  await money.press("Enter");
  await page.getByRole("button", { name: "Mochila", exact: true }).click();
  await expect(page.getByText("#17").first()).toBeVisible();
  await shot(page, "71-legacy-bag-es-light");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Partida guardada.")).toBeVisible();
});

test("un archivo de forma desconocida queda en solo lectura hasta confirmar", async ({ page }) => {
  const unknown = path.join(workDir, "Rare.rxdata");
  execFileSync("ruby", ["-e", "File.binwrite(ARGV[0], Marshal.dump({ 'cosa' => [1, 2, 3], 'otra' => 'x' }))", unknown]);
  bridge.dialogPath = unknown;
  await openSave(page, "es", "Solo lectura: no estoy seguro de qué base es");
  await shot(page, "72-readonly-es-light");
  await page.getByRole("button", { name: "Revisar detección" }).click();
  await expect(page.getByRole("heading", { name: "Detección de la base" })).toBeVisible();
  await shot(page, "73-settings-detection-es-light");
});
