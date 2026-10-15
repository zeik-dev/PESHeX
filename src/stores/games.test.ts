import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameAdded, GameEntry, PreloadEvent, SaveScan } from "../api/games";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  touch: vi.fn(),
  scanSaves: vi.fn(),
  addSaveDir: vi.fn(),
  removeSaveDir: vi.fn(),
  findForSave: vi.fn(),
  seed: vi.fn(),
  cacheDir: vi.fn(),
  preload: vi.fn(),
  preloading: vi.fn(),
}));
let emitPreload: (e: PreloadEvent) => void = () => undefined;
vi.mock("../api/games", () => ({
  gamesApi: api,
  onPreload: vi.fn(async (cb: (e: PreloadEvent) => void) => {
    emitPreload = cb;
    return () => undefined;
  }),
}));

import { initI18n } from "../i18n";
import { useGames } from "./games";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";

const game = (id: string, over: Partial<GameEntry> = {}): GameEntry => ({
  id,
  root: `/juegos/${id}`,
  name: id,
  title: null,
  addedAt: 1,
  lastOpenedAt: null,
  saveDirs: [],
  lastScan: null,
  indexedAt: null,
  fingerprint: null,
  ...over,
});
const scan = (n: number): SaveScan => ({
  dir: "/s",
  source: "gameRoot",
  files: Array.from({ length: n }, (_, i) => ({ name: `Game${i}.rxdata`, path: `/s/Game${i}.rxdata`, size: 10, modified: 1 })),
  candidates: [],
});
const added = (g: GameEntry, n = 1): GameAdded => ({ game: g, created: true, scan: scan(n) });

beforeEach(() => {
  initI18n("es");
  vi.clearAllMocks();
  useToasts.setState({ toasts: [] });
  useSettings.setState({ recentGames: [] });
  useGames.setState({ games: [], loaded: false, scans: {}, preload: {} });
  api.list.mockResolvedValue([]);
  api.preloading.mockResolvedValue([]);
  api.seed.mockResolvedValue(0);
});

describe("biblioteca de juegos (store)", () => {
  it("init carga la lista una sola vez y no falla sin backend", async () => {
    api.list.mockResolvedValue([game("a")]);
    await useGames.getState().init();
    // `init` solo corre una vez por sesion de la app: la segunda llamada no vuelve a pedir nada.
    await useGames.getState().init();
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(useGames.getState().games.map((g) => g.id)).toEqual(["a"]);
    expect(useGames.getState().loaded).toBe(true);
  });

  it("registrar un juego guarda su Save Scan y refresca la lista", async () => {
    const g = game("a");
    api.add.mockResolvedValue(added(g, 2));
    api.list.mockResolvedValue([g]);
    const res = await useGames.getState().add("/juegos/a");
    expect(res?.id).toBe("a");
    expect(useGames.getState().scans["a"]?.files).toHaveLength(2);
    expect(useGames.getState().games).toHaveLength(1);
  });

  it("si no es un juego, avisa con un error y no cambia nada", async () => {
    api.add.mockRejectedValue({ kind: "NotAGameFolder", message: "no es un juego" });
    const res = await useGames.getState().add("/no");
    expect(res).toBeNull();
    expect(useToasts.getState().toasts[0]).toMatchObject({ kind: "error" });
    expect(useGames.getState().games).toEqual([]);
  });

  it("vincular un juego lo registra y lo marca como abierto, sin avisar si falla", async () => {
    const g = game("a");
    api.add.mockResolvedValue(added(g));
    api.list.mockResolvedValue([g]);
    await useGames.getState().registerLinked("/juegos/a");
    expect(api.touch).toHaveBeenCalledWith("a");
    expect(useGames.getState().games).toHaveLength(1);

    api.add.mockRejectedValue(new Error("boom"));
    await expect(useGames.getState().registerLinked("/otro")).resolves.toBeUndefined();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("quitar un juego borra su escaneo de la memoria y refresca", async () => {
    useGames.setState({ games: [game("a"), game("b")], scans: { a: scan(1), b: scan(2) } });
    api.list.mockResolvedValue([game("b")]);
    await useGames.getState().remove("a");
    expect(api.remove).toHaveBeenCalledWith("a");
    expect(useGames.getState().scans).toEqual({ b: expect.anything() });
    expect(useGames.getState().games.map((g) => g.id)).toEqual(["b"]);
  });

  it("re-escanear todos tolera que la carpeta de un juego ya no exista", async () => {
    useGames.setState({ games: [game("a"), game("b")] });
    api.scanSaves.mockImplementation(async (id: string) => {
      if (id === "a") throw { kind: "Io", message: "no existe" };
      return scan(3);
    });
    await useGames.getState().rescanAll();
    expect(useGames.getState().scans["b"]?.files).toHaveLength(3);
    expect(useGames.getState().scans["a"]).toBeUndefined();
    expect(useToasts.getState().toasts).toHaveLength(0);
  });

  it("elegir y quitar una carpeta de guardados actualiza el escaneo", async () => {
    useGames.setState({ games: [game("a")] });
    api.addSaveDir.mockResolvedValue(scan(1));
    api.removeSaveDir.mockResolvedValue(scan(0));
    api.list.mockResolvedValue([game("a", { saveDirs: ["/mis"] })]);
    await useGames.getState().addSaveDir("a", "/mis");
    expect(useGames.getState().scans["a"]?.files).toHaveLength(1);
    expect(useGames.getState().games[0]?.saveDirs).toEqual(["/mis"]);
    api.list.mockResolvedValue([game("a")]);
    await useGames.getState().removeSaveDir("a", "/mis");
    expect(useGames.getState().scans["a"]?.files).toHaveLength(0);
  });

  it("la primera vez siembra la biblioteca con los juegos recientes de versiones anteriores", async () => {
    useSettings.setState({ recentGames: ["/viejo/uno", "/viejo/dos"] });
    api.list.mockResolvedValueOnce([]).mockResolvedValueOnce([game("uno"), game("dos")]);
    // `init` ya corrio en otra prueba de este archivo: se fuerza un store nuevo con modulos aislados.
    vi.resetModules();
    const fresh = (await import("./games")).useGames;
    await fresh.getState().init();
    expect(api.seed).toHaveBeenCalledWith(["/viejo/uno", "/viejo/dos"]);
    expect(fresh.getState().games).toHaveLength(2);
  });

  it("la precarga sigue los eventos con progreso real y termina quitando la barra", async () => {
    vi.resetModules();
    const fresh = (await import("./games")).useGames;
    await fresh.getState().init(); // se suscribe a `games://preload`
    emitPreload({ id: "a", step: "moves", done: 2, total: 9 });
    expect(fresh.getState().preload["a"]).toEqual({ step: "moves", done: 2, total: 9 });
    api.list.mockResolvedValue([game("a", { indexedAt: 5 })]);
    emitPreload({ id: "a", done: true, total: 1 });
    expect(fresh.getState().preload["a"]).toBeUndefined();
  });

  it("no lanza dos precargas del mismo juego a la vez", async () => {
    let finish: () => void = () => undefined;
    api.preload.mockReturnValue(new Promise<void>((r) => (finish = r)));
    api.list.mockResolvedValue([game("a")]);
    const first = useGames.getState().startPreload("a");
    await useGames.getState().startPreload("a");
    expect(api.preload).toHaveBeenCalledTimes(1);
    expect(useGames.getState().preload["a"]).toBeDefined();
    finish();
    await first;
    expect(useGames.getState().preload["a"]).toBeUndefined();
  });
});
