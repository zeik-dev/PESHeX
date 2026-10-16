// Recarga en caliente: el save abierto cambia en el disco por fuera de PESHeX (el jugador guarda desde el juego) y la app lo
// recarga sola. Rust vigila el archivo y emite `save://changed`; aqui la prueba hace de juego (escribe encima del archivo) y de
// Rust (emite el evento). La deteccion (huella, espera a que el archivo deje de cambiar, escrituras propias) se prueba en
// `peshex-core` (`watch`); el comando `reload` del driver, en Ruby y en `crates/rxdriver`.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSave, setup, shot, teardown, type Env } from "./support/harness";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const nav = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();

/** El jugador guarda en el juego: otro save (entrenador «Kizuga») se escribe encima del abierto (entrenador «Furikita»). */
async function gameSaves(e: Env) {
  fs.copyFileSync(path.join(ROOT, "test_saves", "Game.rxdata"), e.savePath);
  await e.bridge.emit!("save://changed", { path: e.savePath });
}

const changedDialog = (page: Page) => page.getByRole("dialog", { name: "El save cambió en el disco" });

test("sin cambios pendientes se recarga solo, sin preguntar, y la vista se queda donde estaba", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Entrenador");
  await expect(page.getByLabel("Nombre")).toHaveValue("Furikita");

  await gameSaves(env);
  await expect(page.getByLabel("Nombre")).toHaveValue("Kizuga", { timeout: 15_000 });
  await expect(page.getByText("El save cambió en el disco y se recargó.")).toBeVisible();
  await expect(changedDialog(page)).toHaveCount(0);
  await shot(page, "182-save-reloaded-es-light");

  // Sigue en «Entrenador» (no vuelve al Resumen) y se puede editar y guardar encima del save recargado
  await page.getByLabel("Dinero").fill("4321");
  await page.getByLabel("Dinero").press("Enter");
  await expect(page.getByRole("button", { name: /^Cambios 1/ })).toBeVisible();
});

test("con cambios sin guardar pregunta: mantener los mios no toca nada", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Entrenador");
  await page.getByLabel("Dinero").fill("777");
  await page.getByLabel("Dinero").press("Enter");
  await expect(page.getByRole("button", { name: /^Cambios 1/ })).toBeVisible();

  await gameSaves(env);
  const d = changedDialog(page);
  await expect(d).toBeVisible({ timeout: 15_000 });
  await shot(page, "183-save-changed-dialog-es-light");
  await d.getByRole("button", { name: "Mantener los míos" }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByLabel("Nombre")).toHaveValue("Furikita");
  await expect(page.getByLabel("Dinero")).toHaveValue("777");
  await expect(page.getByRole("button", { name: /^Cambios 1/ })).toBeVisible();
});

test("con cambios sin guardar, «Recargar y descartar» trae el save del juego y limpia los cambios", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Entrenador");
  await page.getByLabel("Dinero").fill("777");
  await page.getByLabel("Dinero").press("Enter");
  await expect(page.getByRole("button", { name: /^Cambios 1/ })).toBeVisible();

  await gameSaves(env);
  const d = changedDialog(page);
  await expect(d).toBeVisible({ timeout: 15_000 });
  await d.getByRole("button", { name: "Recargar y descartar mis cambios" }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByLabel("Nombre")).toHaveValue("Kizuga", { timeout: 15_000 });
  await expect(page.getByLabel("Dinero")).not.toHaveValue("777");
  await expect(page.getByRole("button", { name: /^Cambios 1/ })).toHaveCount(0);
});

test("con el ajuste apagado no recarga ni pregunta", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Ajustes");
  const toggle = page.getByRole("switch", { name: "Recargar el save si cambia en el disco (p. ej. al guardar en el juego)" });
  await expect(toggle).toHaveAttribute("aria-checked", "true"); // por defecto esta activo
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await nav(page, "Entrenador");

  await gameSaves(env);
  await page.waitForTimeout(2500);
  await expect(page.getByLabel("Nombre")).toHaveValue("Furikita");
  await expect(changedDialog(page)).toHaveCount(0);
  await expect(page.getByText("El save cambió en el disco y se recargó.")).toHaveCount(0);
});

test("un aviso de otro archivo se ignora", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env);
  await nav(page, "Entrenador");
  fs.copyFileSync(path.join(ROOT, "test_saves", "Game.rxdata"), env.savePath);
  await env.bridge.emit!("save://changed", { path: path.join(env.workDir, "Otro.rxdata") });
  await page.waitForTimeout(2500);
  await expect(page.getByLabel("Nombre")).toHaveValue("Furikita");
});

test("English: the dialog and the notice are translated", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env, "en");
  await nav(page, "Trainer");
  await page.getByLabel("Money").fill("777");
  await page.getByLabel("Money").press("Enter");
  await expect(page.getByRole("button", { name: /^Changes 1/ })).toBeVisible();
  await gameSaves(env);
  const d = page.getByRole("dialog", { name: "The save changed on disk" });
  await expect(d).toBeVisible({ timeout: 15_000 });
  await d.getByRole("button", { name: "Reload and discard my changes" }).click();
  await expect(page.getByText("The save changed on disk and was reloaded.")).toBeVisible({ timeout: 15_000 });
});
