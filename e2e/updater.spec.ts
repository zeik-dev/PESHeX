// Actualizaciones desde GitHub Releases: aviso de version nueva, descarga con progreso (pausar / reanudar / cancelar),
// instalar y reiniciar, omitir, errores y la tarjeta de Ajustes. El actualizador real (PESHeX-Updater.exe) se simula en el
// puente: la prueba dicta que responde `update_check` y emite los eventos `updater://event` que mandaria el proceso.
import { expect, test, type Page } from "@playwright/test";
import { openSave, setup, shot, silenceGamePrompt, teardown, type Env } from "./support/harness";

let env: Env | undefined;

test.afterEach(async () => {
  await teardown(env);
  env = undefined;
});

const RELEASE = {
  tag: "v9.9.9",
  version: "9.9.9",
  name: "PESHeX 9.9.9",
  notes: "### Novedades de la 9.9.9\n- **Biblioteca** de juegos\n- Actualizaciones automáticas\n\nTexto suelto",
  url: "https://github.com/zeik-dev/PESHeX/releases/tag/v9.9.9",
  publishedAt: "2026-10-20T10:00:00Z",
  prerelease: false,
  asset: { name: "PESHeX-9.9.9-windows-x64.zip", url: "https://github.com/zeik-dev/PESHeX/releases/download/v9.9.9/PESHeX-9.9.9-windows-x64.zip", size: 20_000_000 },
  sumsUrl: "https://github.com/zeik-dev/PESHeX/releases/download/v9.9.9/SHA256SUMS.txt",
};

const nav = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();
const emit = (page: Page, payload: unknown) => env!.bridge.emit!("updater://event", payload);
const dialog = (page: Page) => page.getByRole("dialog", { name: "Actualización disponible" });

/** Arranca en la pantalla de inicio con un actualizador que encuentra la 9.9.9 (`openSaveLater`: sin aviso de carpeta del juego al abrir la partida). */
async function startWithUpdate(page: Page, openSaveLater = false) {
  env = await setup(page);
  env.bridge.updater.available = true;
  env.bridge.updater.check = { status: "available", release: RELEASE };
  await silenceGamePrompt(page, openSaveLater ? env.savePath : null, "es");
  await page.goto("/");
  await expect(dialog(page)).toBeVisible({ timeout: 15_000 }); // la busqueda automatica sale unos segundos despues de arrancar
}

test("al iniciar avisa de la version nueva con sus notas y permite descargar, pausar, reanudar e instalar", async ({ page }) => {
  await startWithUpdate(page);
  const d = dialog(page);
  await expect(d.getByText(/PESHeX 9\.9\.9 está disponible \(tienes la \d+\.\d+\.\d+\)/)).toBeVisible();
  await expect(d.getByText("Descarga de 19,1 MB")).toBeVisible();
  const notes = d.getByTestId("update-notes");
  await expect(notes.getByRole("heading", { name: "Novedades de la 9.9.9" })).toBeVisible();
  await expect(notes.getByText("Biblioteca")).toBeVisible();
  await expect(notes.getByRole("listitem")).toHaveCount(2);
  await shot(page, "170-update-available-es-light");

  await d.getByRole("button", { name: "Descargar e instalar" }).click();
  expect(env!.bridge.updater.calls).toContain("start");
  expect(env!.bridge.updater.started?.version).toBe("9.9.9");

  // Progreso real: bytes, velocidad y tiempo restante
  await emit(page, { event: "state", state: "downloading" });
  await emit(page, { event: "progress", downloaded: 8_000_000, total: 20_000_000, bytesPerSec: 2_000_000 });
  const bar = d.getByRole("progressbar");
  await expect(bar).toHaveAttribute("aria-valuenow", "40");
  await expect(d.getByTestId("update-stats")).toContainText("7,6 MB de 19,1 MB");
  await expect(d.getByTestId("update-stats")).toContainText("1,9 MB/s");
  await expect(d.getByTestId("update-stats")).toContainText("quedan 6 s");
  await shot(page, "171-update-downloading-es-light");

  await d.getByRole("button", { name: "Pausar" }).click();
  expect(env!.bridge.updater.calls).toContain("pause");
  await emit(page, { event: "state", state: "paused" });
  await expect(d.getByRole("button", { name: "Reanudar" })).toBeVisible();
  await expect(d.getByText("Descarga en pausa").first()).toBeVisible();
  await expect(d.getByTestId("update-stats")).not.toContainText("/s"); // en pausa no hay velocidad
  await d.getByRole("button", { name: "Reanudar" }).click();
  expect(env!.bridge.updater.calls).toContain("resume");
  await emit(page, { event: "state", state: "downloading" });
  await expect(d.getByRole("button", { name: "Pausar" })).toBeVisible();

  await emit(page, { event: "progress", downloaded: 20_000_000, total: 20_000_000, bytesPerSec: 2_000_000 });
  await emit(page, { event: "state", state: "verifying" });
  await expect(d.getByText("Verificando la descarga (SHA-256)…")).toBeVisible();
  await expect(d.getByRole("button", { name: "Pausar" })).toBeDisabled();
  await emit(page, { event: "verified", sha256: "a".repeat(64) });
  await emit(page, { event: "state", state: "extracting" });
  await expect(d.getByText("Preparando los archivos…")).toBeVisible();
  await emit(page, { event: "state", state: "ready" });
  await expect(d.getByText(/Al instalar, PESHeX se cerrará/)).toBeVisible();
  await shot(page, "172-update-ready-es-light");

  await d.getByRole("button", { name: "Instalar y reiniciar" }).click();
  expect(env!.bridge.updater.calls.at(-1)).toBe("apply");
  await expect(d.getByText(/Instalando… PESHeX se cerrará/)).toBeVisible();
});

test("cancelar la descarga vuelve a ofrecer la version", async ({ page }) => {
  await startWithUpdate(page);
  const d = dialog(page);
  await d.getByRole("button", { name: "Descargar e instalar" }).click();
  await emit(page, { event: "state", state: "downloading" });
  await emit(page, { event: "progress", downloaded: 1_000_000, total: 20_000_000, bytesPerSec: 500_000 });
  await d.getByRole("button", { name: "Cancelar descarga" }).click();
  expect(env!.bridge.updater.calls).toContain("cancel");
  await emit(page, { event: "state", state: "cancelled" });
  await emit(page, { event: "exited", code: 0 });
  await expect(d.getByRole("button", { name: "Descargar e instalar" })).toBeVisible();
  await expect(d.getByRole("progressbar")).toHaveCount(0);
});

test("«Recordármelo luego» oculta el aviso y deja un botón en la cabecera para volver a abrirlo", async ({ page }) => {
  await startWithUpdate(page);
  await dialog(page).getByRole("button", { name: "Recordármelo luego" }).click();
  await expect(dialog(page)).toHaveCount(0);
  const badge = page.getByTestId("update-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAccessibleName("Actualización disponible: 9.9.9");
  await badge.click();
  await expect(dialog(page)).toBeVisible();
  await expect(badge).toHaveCount(0);
});

test("una descarga en curso sigue al ocultar el dialogo y el boton de la cabecera la recupera", async ({ page }) => {
  await startWithUpdate(page);
  await dialog(page).getByRole("button", { name: "Descargar e instalar" }).click();
  await emit(page, { event: "state", state: "downloading" });
  await emit(page, { event: "progress", downloaded: 5_000_000, total: 20_000_000, bytesPerSec: 1_000_000 });
  await dialog(page).getByRole("button", { name: "Ocultar" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await emit(page, { event: "progress", downloaded: 10_000_000, total: 20_000_000, bytesPerSec: 1_000_000 });
  await page.getByTestId("update-badge").click();
  await expect(dialog(page).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
});

test("omitir una version no vuelve a avisar de ella y Ajustes permite volver a avisar", async ({ page }) => {
  await startWithUpdate(page, true);
  await dialog(page).getByRole("button", { name: "Omitir esta versión" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByTestId("update-badge")).toHaveCount(0);

  // Con la partida abierta, la tarjeta de Ajustes recuerda que se omitió
  env!.bridge.updater.calls.length = 0;
  await page.getByRole("button", { name: "Abrir partida…" }).click();
  await expect(page.getByText("Furikita").first()).toBeVisible({ timeout: 20_000 });
  await nav(page, "Ajustes");
  await expect(page.getByText("Omitiste la versión 9.9.9.")).toBeVisible();
  await page.getByRole("button", { name: "Volver a avisarme" }).click();
  await expect(page.getByText("Omitiste la versión 9.9.9.")).toHaveCount(0);
});

test("un error del actualizador se explica en español y se puede reintentar", async ({ page }) => {
  await startWithUpdate(page);
  const d = dialog(page);
  await d.getByRole("button", { name: "Descargar e instalar" }).click();
  await emit(page, { event: "state", state: "downloading" });
  await emit(page, { event: "state", state: "verifying" });
  await emit(page, { event: "error", code: "hash_mismatch", message: "la huella SHA-256 no coincide" });
  await expect(d.getByText("No se pudo actualizar")).toBeVisible();
  await expect(d.getByText(/no coincide con su huella SHA-256/)).toBeVisible();
  await expect(d.getByText("la huella SHA-256 no coincide")).toBeVisible(); // el detalle tecnico, aparte
  await shot(page, "173-update-error-es-light");
  // El registro de diagnóstico: aviso y botón que abre su carpeta (updater.log)
  await expect(d.getByText(/envía el archivo updater\.log/)).toBeVisible();
  await d.getByRole("button", { name: "Mostrar el registro" }).click();
  await expect.poll(() => env!.bridge.updater.revealed).toEqual(["C:\\Users\\Alex\\AppData\\Roaming\\com.zeik.peshex\\updates\\updater.log"]);
  env!.bridge.updater.calls.length = 0;
  await d.getByRole("button", { name: "Reintentar" }).click();
  expect(env!.bridge.updater.calls).toEqual(["start"]);
  await expect(d.getByText("No se pudo actualizar")).toHaveCount(0);
});

test("si el proceso del actualizador muere sin avisar, se muestra como fallo", async ({ page }) => {
  await startWithUpdate(page);
  const d = dialog(page);
  await d.getByRole("button", { name: "Descargar e instalar" }).click();
  await emit(page, { event: "state", state: "downloading" });
  await emit(page, { event: "exited", code: 1 });
  await expect(d.getByText("No se pudo actualizar")).toBeVisible();
  await expect(d.getByText("El actualizador se cerró de forma inesperada.")).toBeVisible();
});

test("instalar con cambios sin guardar pregunta antes", async ({ page }) => {
  env = await setup(page);
  env.bridge.updater.available = true;
  env.bridge.updater.check = { status: "upToDate", current: "1.0.0", latest: "1.0.0" };
  await openSave(page, env);
  await nav(page, "Entrenador");
  await page.getByLabel("Dinero").fill("777");
  await page.getByLabel("Dinero").press("Enter");
  await expect(page.getByRole("button", { name: /^Cambios 1/ })).toBeVisible();
  // Una actualizacion llega y queda lista
  env.bridge.updater.check = { status: "available", release: RELEASE };
  await nav(page, "Ajustes");
  await page.getByRole("button", { name: "Buscar actualizaciones" }).click();
  const d = dialog(page);
  await expect(d).toBeVisible();
  await d.getByRole("button", { name: "Descargar e instalar" }).click();
  await emit(page, { event: "state", state: "ready" });
  await d.getByRole("button", { name: "Instalar y reiniciar" }).click();
  const confirm = page.getByRole("dialog", { name: "Hay cambios sin guardar" });
  await expect(confirm).toBeVisible();
  expect(env.bridge.updater.calls).not.toContain("apply");
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toHaveCount(0);
  expect(env.bridge.updater.calls).not.toContain("apply");
  await d.getByRole("button", { name: "Instalar y reiniciar" }).click();
  await page.getByRole("dialog", { name: "Hay cambios sin guardar" }).getByRole("button", { name: "Instalar sin guardar" }).click();
  expect(env.bridge.updater.calls.at(-1)).toBe("apply");
});

test("la busqueda al iniciar se ve en la pantalla de inicio: buscando, al dia y se retira sola", async ({ page }) => {
  env = await setup(page);
  env.bridge.updater.available = true;
  env.bridge.updater.check = { status: "upToDate", current: "1.0.0", latest: "1.0.0" };
  await silenceGamePrompt(page, null, "es");
  await page.goto("/");
  const status = page.getByTestId("update-status");
  await expect(status).toHaveText("Estás al día", { timeout: 15_000 }); // sale unos segundos despues de arrancar
  await expect(status).toHaveAttribute("data-kind", "upToDate");
  await expect(status).toHaveCount(0, { timeout: 10_000 }); // se retira sola
  expect(env.bridge.updater.calls.filter((c) => c === "check")).toHaveLength(1);
});

test("si la busqueda al iniciar falla, el inicio lo avisa con el motivo", async ({ page }) => {
  env = await setup(page);
  env.bridge.updater.available = true;
  env.bridge.updater.check = { status: "error", code: "network", message: "sin red" };
  await silenceGamePrompt(page, null, "es");
  await page.goto("/");
  const status = page.getByTestId("update-status");
  await expect(status).toHaveText("No se pudo buscar actualizaciones", { timeout: 15_000 });
  await expect(status).toHaveAttribute("title", /sin red/);
});

test("Ajustes: buscar a mano dice si estas al dia o por que no se pudo", async ({ page }) => {
  env = await setup(page);
  env.bridge.updater.available = true;
  env.bridge.updater.check = { status: "upToDate", current: "1.0.0", latest: "1.0.0" };
  await openSave(page, env);
  await nav(page, "Ajustes");
  await page.getByRole("button", { name: "Buscar actualizaciones" }).click();
  await expect(page.getByTestId("update-uptodate")).toHaveText("Tienes la última versión (1.0.0).");
  await shot(page, "174-update-settings-es-light");

  env.bridge.updater.check = { status: "error", code: "rate_limited", message: "403" };
  await page.getByRole("button", { name: "Buscar actualizaciones" }).click();
  await expect(page.getByText("No se pudo buscar actualizaciones")).toBeVisible();
  await expect(page.getByText(/GitHub limitó las consultas/)).toBeVisible();
  await expect(page.getByTestId("update-uptodate")).toHaveCount(0);
});

test("sin actualizador (version de desarrollo) Ajustes lo explica y no busca", async ({ page }) => {
  env = await setup(page);
  await openSave(page, env); // updater.available = false por defecto
  await nav(page, "Ajustes");
  await expect(page.getByTestId("update-unsupported")).toContainText("no puede actualizarse sola");
  await expect(page.getByRole("button", { name: "Buscar actualizaciones" })).toHaveCount(0);
  expect(env.bridge.updater.calls).toEqual([]);
});

test("tras una actualizacion, la app recien abierta cuenta como fue", async ({ page }) => {
  env = await setup(page);
  env.bridge.updater.available = true;
  env.bridge.updater.lastResult = { ok: true, version: "9.9.9" };
  await silenceGamePrompt(page, null, "es");
  await page.goto("/");
  await expect(page.getByText("PESHeX se actualizó a la versión 9.9.9.")).toBeVisible();
});

test("English: the dialog and the error are translated", async ({ page }) => {
  env = await setup(page);
  env.bridge.updater.available = true;
  env.bridge.updater.check = { status: "available", release: RELEASE };
  await silenceGamePrompt(page, null, "en");
  await page.goto("/");
  const d = page.getByRole("dialog", { name: "Update available" });
  await expect(d).toBeVisible({ timeout: 15_000 });
  await expect(d.getByText("19.1 MB download")).toBeVisible();
  await d.getByRole("button", { name: "Download and install" }).click();
  await env.bridge.emit!("updater://event", { event: "error", code: "network", message: "x" });
  await expect(d.getByText(/Cannot reach GitHub/)).toBeVisible();
  await shot(page, "175-update-error-en-light");
});
