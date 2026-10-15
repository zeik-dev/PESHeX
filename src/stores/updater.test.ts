import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckResult, ReleaseInfo, UpdaterEvent } from "../api/updater";

const api = vi.hoisted(() => ({
  available: vi.fn(),
  check: vi.fn(),
  start: vi.fn(),
  control: vi.fn(),
  apply: vi.fn(),
  lastResult: vi.fn(),
}));
let emit: (e: UpdaterEvent) => void = () => undefined;
vi.mock("../api/updater", () => ({
  updaterApi: api,
  onUpdaterEvent: vi.fn(async (cb: (e: UpdaterEvent) => void) => {
    emit = cb;
    return () => undefined;
  }),
}));

import { initI18n } from "../i18n";
import { useSession } from "./session";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";
import { resetUpdaterForTests, useUpdater } from "./updater";

const release = (version: string): ReleaseInfo => ({
  tag: `v${version}`,
  version,
  name: `PESHeX ${version}`,
  notes: "- algo",
  url: "https://github.com/zeik-dev/PESHeX/releases/tag/v1",
  publishedAt: null,
  prerelease: false,
  asset: { name: `PESHeX-${version}-windows-x64.zip`, url: "https://github.com/x.zip", size: 1000 },
  sumsUrl: "https://github.com/SHA256SUMS.txt",
});

const available = (v = "1.2.0"): CheckResult => ({ status: "available", release: release(v) });

beforeEach(() => {
  initI18n("es");
  vi.clearAllMocks();
  vi.useRealTimers();
  resetUpdaterForTests();
  useToasts.setState({ toasts: [] });
  useSettings.setState({ updateCheckOnStart: true, updateLastCheck: 0, updateSkipped: null });
  useSession.setState({ pendingCount: 0 });
  api.available.mockResolvedValue(true);
  api.lastResult.mockResolvedValue(null);
  api.control.mockResolvedValue(undefined);
  api.start.mockResolvedValue(undefined);
  api.apply.mockResolvedValue(undefined);
});

describe("actualizador: arranque", () => {
  it("sin actualizador junto a la app (desarrollo) no hace nada", async () => {
    api.available.mockResolvedValue(false);
    await useUpdater.getState().init();
    expect(useUpdater.getState().supported).toBe(false);
    await useUpdater.getState().check(true);
    expect(api.check).not.toHaveBeenCalled();
  });

  it("cuenta como fue el ultimo reemplazo (una vez)", async () => {
    api.lastResult.mockResolvedValue({ ok: true, version: "1.2.0" });
    await useUpdater.getState().init();
    expect(useToasts.getState().toasts).toHaveLength(1);
    expect(useToasts.getState().toasts[0]).toMatchObject({ kind: "success" });
    expect(useToasts.getState().toasts[0]?.text).toContain("1.2.0");
  });

  it("un reemplazo fallido se avisa como error con el motivo", async () => {
    api.lastResult.mockResolvedValue({ ok: false, version: "1.2.0", code: "io", message: "disco lleno" });
    await useUpdater.getState().init();
    expect(useToasts.getState().toasts[0]).toMatchObject({ kind: "error" });
    expect(useToasts.getState().toasts[0]?.text).toContain("disco lleno");
  });

  it("busca sola al iniciar como mucho una vez al dia", async () => {
    vi.useFakeTimers();
    api.check.mockResolvedValue({ status: "upToDate", current: "1.2.0", latest: "1.2.0" });
    useSettings.setState({ updateLastCheck: Date.now() - 60 * 60 * 1000 }); // hace una hora
    await useUpdater.getState().init();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.check).not.toHaveBeenCalled();

    resetUpdaterForTests();
    useSettings.setState({ updateLastCheck: Date.now() - 25 * 60 * 60 * 1000 }); // hace mas de un dia
    await useUpdater.getState().init();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.check).toHaveBeenCalledTimes(1);
  });

  it("no busca sola si el usuario lo desactivo", async () => {
    vi.useFakeTimers();
    useSettings.setState({ updateCheckOnStart: false });
    await useUpdater.getState().init();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.check).not.toHaveBeenCalled();
  });
});

describe("actualizador: busqueda", () => {
  beforeEach(async () => {
    await useUpdater.getState().init();
  });

  it("hay version nueva: abre el dialogo y anota la busqueda", async () => {
    api.check.mockResolvedValue(available());
    await useUpdater.getState().check(false);
    const s = useUpdater.getState();
    expect(s.phase).toBe("available");
    expect(s.release?.version).toBe("1.2.0");
    expect(s.dialogOpen).toBe(true);
    expect(useSettings.getState().updateLastCheck).toBeGreaterThan(0);
  });

  it("una version omitida no abre el dialogo sola, pero si al buscar a mano", async () => {
    useSettings.setState({ updateSkipped: "1.2.0" });
    api.check.mockResolvedValue(available());
    await useUpdater.getState().check(false);
    expect(useUpdater.getState().phase).toBe("available");
    expect(useUpdater.getState().dialogOpen).toBe(false);
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().dialogOpen).toBe(true);
    // Y una version posterior a la omitida vuelve a avisar
    useUpdater.getState().hideDialog();
    api.check.mockResolvedValue(available("1.3.0"));
    await useUpdater.getState().check(false);
    expect(useUpdater.getState().dialogOpen).toBe(true);
  });

  it("al dia: lo recuerda para Ajustes", async () => {
    api.check.mockResolvedValue({ status: "upToDate", current: "1.2.0", latest: "1.2.0" });
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().phase).toBe("idle");
    expect(useUpdater.getState().lastCheck).toEqual({ status: "upToDate", version: "1.2.0" });
  });

  it("error de red: no abre nada, deja el motivo", async () => {
    api.check.mockResolvedValue({ status: "error", code: "network", message: "sin red" });
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().dialogOpen).toBe(false);
    expect(useUpdater.getState().lastCheck).toEqual({ status: "error", code: "network", message: "sin red" });
  });

  it("si el comando falla, tambien es un error mostrable (no una excepcion)", async () => {
    api.check.mockRejectedValue({ kind: "UpdaterUnavailable", message: "no hay" });
    await useUpdater.getState().check(true);
    expect(useUpdater.getState().lastCheck).toMatchObject({ status: "error", code: "UpdaterUnavailable" });
  });

  it("no lanza una busqueda mientras se descarga", async () => {
    api.check.mockResolvedValue(available());
    await useUpdater.getState().check(true);
    await useUpdater.getState().start();
    api.check.mockClear();
    await useUpdater.getState().check(true);
    expect(api.check).not.toHaveBeenCalled();
  });

  it("omitir guarda la version y cierra", async () => {
    api.check.mockResolvedValue(available());
    await useUpdater.getState().check(false);
    useUpdater.getState().skip();
    expect(useSettings.getState().updateSkipped).toBe("1.2.0");
    expect(useUpdater.getState().dialogOpen).toBe(false);
    expect(useUpdater.getState().phase).toBe("idle");
  });
});

describe("actualizador: descarga e instalacion", () => {
  beforeEach(async () => {
    await useUpdater.getState().init();
    api.check.mockResolvedValue(available());
    await useUpdater.getState().check(false);
  });

  it("empezar envia la version al actualizador y pasa a descargar", async () => {
    await useUpdater.getState().start();
    expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ version: "1.2.0" }));
    expect(useUpdater.getState().phase).toBe("downloading");
    expect(useUpdater.getState().progress).toEqual({ downloaded: 0, total: 1000, bytesPerSec: 0 });
  });

  it("sigue los eventos: progreso, pausa, reanudar, verificar, preparar y listo", async () => {
    await useUpdater.getState().start();
    emit({ event: "progress", downloaded: 400, total: 1000, bytesPerSec: 50 });
    expect(useUpdater.getState().progress).toEqual({ downloaded: 400, total: 1000, bytesPerSec: 50 });
    await useUpdater.getState().pause();
    expect(api.control).toHaveBeenLastCalledWith("pause");
    emit({ event: "state", state: "paused" });
    expect(useUpdater.getState().phase).toBe("paused");
    await useUpdater.getState().resume();
    expect(api.control).toHaveBeenLastCalledWith("resume");
    emit({ event: "state", state: "downloading" });
    emit({ event: "state", state: "verifying" });
    expect(useUpdater.getState().phase).toBe("verifying");
    emit({ event: "state", state: "extracting" });
    emit({ event: "state", state: "ready" });
    expect(useUpdater.getState().phase).toBe("ready");
  });

  it("cancelar vuelve a «hay una version» sin perder la version", async () => {
    await useUpdater.getState().start();
    await useUpdater.getState().cancel();
    expect(api.control).toHaveBeenLastCalledWith("cancel");
    emit({ event: "state", state: "cancelled" });
    expect(useUpdater.getState().phase).toBe("available");
    expect(useUpdater.getState().release?.version).toBe("1.2.0");
    expect(useUpdater.getState().progress.downloaded).toBe(0);
  });

  it("un error del actualizador abre el dialogo con el codigo", async () => {
    await useUpdater.getState().start();
    useUpdater.getState().hideDialog();
    emit({ event: "error", code: "hash_mismatch", message: "x" });
    const s = useUpdater.getState();
    expect(s.phase).toBe("failed");
    expect(s.error).toEqual({ code: "hash_mismatch", message: "x" });
    expect(s.dialogOpen).toBe(true);
    useUpdater.getState().clearFailure();
    expect(useUpdater.getState().phase).toBe("available");
    expect(useUpdater.getState().error).toBeNull();
  });

  it("si el proceso se cierra sin avisar a mitad de la descarga, es un fallo", async () => {
    await useUpdater.getState().start();
    emit({ event: "exited", code: 1 });
    expect(useUpdater.getState().phase).toBe("failed");
  });

  it("que el proceso termine despues de cancelar no es un fallo", async () => {
    await useUpdater.getState().start();
    emit({ event: "state", state: "cancelled" });
    emit({ event: "exited", code: 0 });
    expect(useUpdater.getState().phase).toBe("available");
  });

  it("si no se puede lanzar el actualizador, fallo mostrable", async () => {
    api.start.mockRejectedValue({ kind: "SpawnFailed", message: "no" });
    await useUpdater.getState().start();
    expect(useUpdater.getState().phase).toBe("failed");
    expect(useUpdater.getState().error?.code).toBe("SpawnFailed");
  });

  it("instalar solo cuando esta listo", async () => {
    await useUpdater.getState().start();
    await useUpdater.getState().apply();
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("instala y reinicia cuando esta listo y no hay cambios pendientes", async () => {
    await useUpdater.getState().start();
    emit({ event: "state", state: "ready" });
    await useUpdater.getState().apply();
    expect(api.apply).toHaveBeenCalledTimes(1);
    expect(useUpdater.getState().phase).toBe("applying");
  });

  it("con cambios sin guardar pregunta antes y solo instala al confirmar", async () => {
    useSession.setState({ pendingCount: 3 });
    await useUpdater.getState().start();
    emit({ event: "state", state: "ready" });
    await useUpdater.getState().apply();
    expect(api.apply).not.toHaveBeenCalled();
    expect(useUpdater.getState().confirmUnsaved).toBe(true);
    useUpdater.getState().dismissUnsaved();
    expect(useUpdater.getState().confirmUnsaved).toBe(false);
    expect(useUpdater.getState().phase).toBe("ready");
    await useUpdater.getState().apply(true);
    expect(api.apply).toHaveBeenCalledTimes(1);
  });
});
