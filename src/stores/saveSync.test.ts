import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenResult } from "../api/types";

const api = vi.hoisted(() => ({ reloadSave: vi.fn(), onSaveChanged: vi.fn() }));
vi.mock("../api/tauri", async (orig) => ({ ...(await orig<typeof import("../api/tauri")>()), reloadSave: api.reloadSave, onSaveChanged: api.onSaveChanged }));

import { semantic } from "../api/semantic";
import { initI18n } from "../i18n";
import { usePc } from "./pc";
import { resetSaveSyncForTests, useSaveSync } from "./saveSync";
import { useSession } from "./session";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";

const PATH = "/saves/Game.rxdata";
const opened = (revision: number): OpenResult => ({
  roots: 1, wrapper: "", fileSize: 10, indexState: "idle", roundtripChecked: false, revision, profile: { id: "essentials_legacy" } as never,
});

let emit: (e: { path: string }) => void = () => undefined;

beforeEach(async () => {
  initI18n("es");
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetSaveSyncForTests();
  useToasts.setState({ toasts: [] });
  useSettings.setState({ autoReload: true });
  usePc.setState({ box: 3, selected: "boxes/3/1" });
  useSession.setState({ filePath: PATH, revision: 5, reloads: 0, pendingCount: 0, redoCount: 0, saving: false, view: "party", editorRef: "party/0", roundtrip: null });
  vi.spyOn(semantic, "verifyRoundtrip").mockResolvedValue({ roundtripClean: true, diffByte: null });
  api.reloadSave.mockResolvedValue(opened(9));
  api.onSaveChanged.mockImplementation(async (cb: (e: { path: string }) => void) => {
    emit = cb;
    return () => undefined;
  });
  await useSaveSync.getState().init();
});

describe("recarga en caliente del save", () => {
  it("sin cambios pendientes recarga en silencio y avisa", async () => {
    emit({ path: PATH });
    await vi.advanceTimersByTimeAsync(100);
    expect(api.reloadSave).toHaveBeenCalledTimes(1);
    const s = useSession.getState();
    expect(s.revision).toBe(9);
    expect(s.reloads).toBe(1);
    expect(s.view).toBe("party"); // no se vuelve al Resumen
    expect(s.editorRef).toBeNull(); // la ficha abierta era del documento viejo
    expect(usePc.getState()).toMatchObject({ box: null, selected: null });
    expect(useToasts.getState().toasts[0]).toMatchObject({ kind: "info", text: "El save cambió en el disco y se recargó." });
    expect(useSaveSync.getState().conflict).toBe(false);
  });

  it("la revision nunca baja (las consultas no sirven datos viejos)", async () => {
    api.reloadSave.mockResolvedValue(opened(2));
    emit({ path: PATH });
    await vi.runAllTimersAsync();
    expect(useSession.getState().revision).toBe(5);
  });

  it("ignora el aviso de otro archivo, con el ajuste apagado o sin partida abierta", async () => {
    emit({ path: "/saves/Otra.rxdata" });
    useSettings.setState({ autoReload: false });
    emit({ path: PATH });
    useSettings.setState({ autoReload: true });
    useSession.setState({ filePath: null });
    emit({ path: PATH });
    await vi.runAllTimersAsync();
    expect(api.reloadSave).not.toHaveBeenCalled();
    expect(useSaveSync.getState().conflict).toBe(false);
  });

  it("con cambios sin guardar no pisa nada: pregunta", async () => {
    useSession.setState({ pendingCount: 2 });
    emit({ path: PATH });
    await vi.runAllTimersAsync();
    expect(api.reloadSave).not.toHaveBeenCalled();
    expect(useSaveSync.getState().conflict).toBe(true);
    expect(useSession.getState().pendingCount).toBe(2);
  });

  it("mientras se guarda desde PESHeX tampoco recarga", async () => {
    useSession.setState({ saving: true });
    emit({ path: PATH });
    await vi.runAllTimersAsync();
    expect(api.reloadSave).not.toHaveBeenCalled();
    expect(useSaveSync.getState().conflict).toBe(true);
  });

  it("«Recargar y descartar» recarga y descarta los cambios", async () => {
    useSession.setState({ pendingCount: 2, redoCount: 1 });
    emit({ path: PATH });
    await vi.runAllTimersAsync();
    await useSaveSync.getState().reload();
    expect(useSession.getState()).toMatchObject({ pendingCount: 0, redoCount: 0, revision: 9 });
    expect(useSaveSync.getState().conflict).toBe(false);
  });

  it("«Mantener los míos» cierra el aviso y no recarga", async () => {
    useSession.setState({ pendingCount: 1 });
    emit({ path: PATH });
    await vi.runAllTimersAsync();
    useSaveSync.getState().keepMine();
    expect(useSaveSync.getState().conflict).toBe(false);
    expect(api.reloadSave).not.toHaveBeenCalled();
    expect(useSession.getState().pendingCount).toBe(1);
  });

  it("si el archivo esta a medio escribir reintenta y al final recarga", async () => {
    api.reloadSave.mockRejectedValueOnce({ kind: "FormatError", message: "truncado" }).mockRejectedValueOnce({ kind: "FormatError", message: "truncado" });
    emit({ path: PATH });
    await vi.advanceTimersByTimeAsync(3100); // dos esperas de 1,5 s; el aviso aun no caduco (4,5 s)
    expect(api.reloadSave).toHaveBeenCalledTimes(3);
    expect(useSession.getState().revision).toBe(9);
    expect(useToasts.getState().toasts.map((t) => t.kind)).toEqual(["info"]);
  });

  it("si no consigue leerlo avisa y conserva lo abierto", async () => {
    api.reloadSave.mockRejectedValue({ kind: "FormatError", message: "truncado" });
    emit({ path: PATH });
    await vi.advanceTimersByTimeAsync(3100);
    expect(api.reloadSave).toHaveBeenCalledTimes(3);
    expect(useToasts.getState().toasts[0]).toMatchObject({ kind: "warning" });
    expect(useToasts.getState().toasts[0]?.text).toContain("no se pudo recargar");
    expect(useSession.getState()).toMatchObject({ revision: 5, reloads: 0, view: "party", editorRef: "party/0" });
    expect(useSaveSync.getState().reloading).toBe(false);
  });

  it("otro aviso mientras recarga provoca una recarga mas", async () => {
    let release: (r: OpenResult) => void = () => undefined;
    api.reloadSave.mockImplementationOnce(() => new Promise<OpenResult>((resolve) => (release = resolve)));
    emit({ path: PATH });
    await vi.advanceTimersByTimeAsync(0);
    expect(useSaveSync.getState().reloading).toBe(true);
    emit({ path: PATH });
    await vi.advanceTimersByTimeAsync(0);
    release(opened(7));
    await vi.runAllTimersAsync();
    expect(api.reloadSave).toHaveBeenCalledTimes(2);
  });

  it("cambiar de archivo descarta el aviso pendiente", async () => {
    useSession.setState({ pendingCount: 1 });
    emit({ path: PATH });
    await vi.runAllTimersAsync();
    expect(useSaveSync.getState().conflict).toBe(true);
    useSession.setState({ filePath: "/saves/Otra.rxdata" });
    expect(useSaveSync.getState().conflict).toBe(false);
  });

  it("si se cierra el archivo mientras recarga, no toca el estado", async () => {
    let release: (r: OpenResult) => void = () => undefined;
    api.reloadSave.mockImplementationOnce(() => new Promise<OpenResult>((resolve) => (release = resolve)));
    emit({ path: PATH });
    await vi.advanceTimersByTimeAsync(0);
    useSession.setState({ filePath: null, revision: 0, reloads: 0 });
    release(opened(9));
    await vi.runAllTimersAsync();
    expect(useSession.getState()).toMatchObject({ filePath: null, revision: 0, reloads: 0 });
  });
});
