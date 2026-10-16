import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../api/games", () => ({
  gamesApi: { list: vi.fn(async () => []), scanSaves: vi.fn(async () => null), preloading: vi.fn(async () => []) },
  onPreload: vi.fn(async () => () => undefined),
}));

import { initI18n } from "../i18n";
import { useGames } from "../stores/games";
import { useSession } from "../stores/session";
import { useSettings } from "../stores/settings";
import { resetUpdaterForTests, useUpdater } from "../stores/updater";
import { useUi } from "../stores/ui";
import { initialOpenTab, OpenScreen } from "./OpenScreen";

const game = (id: string) => ({ id, root: `/j/${id}`, name: id, title: null, addedAt: 1, lastOpenedAt: null, saveDirs: [], lastScan: null, indexedAt: null, fingerprint: null });

afterEach(() => {
  cleanup();
  resetUpdaterForTests();
  useUi.setState({ homeSettingsOpen: false });
});

beforeEach(() => {
  initI18n("es");
  useSettings.setState({ recent: [], openTab: null });
  useGames.setState({ games: [], loaded: true, scans: {}, preload: {} });
  useSession.setState({ opening: false, openError: null });
});

describe("initialOpenTab", () => {
  it("respeta la última pestaña elegida", () => {
    expect(initialOpenTab("games", 5)).toBe("games");
    expect(initialOpenTab("recent", 0)).toBe("recent");
  });
  it("sin elección: recientes si las hay y si no, juegos guardados", () => {
    expect(initialOpenTab(null, 2)).toBe("recent");
    expect(initialOpenTab(null, 0)).toBe("games");
  });
});

describe("OpenScreen", () => {
  it("con recientes enseña la lista, con el conteo en el tab, y quitar una no cambia de pestaña", () => {
    useSettings.setState({ recent: ["/s/Uno.rxdata", "/s/Dos.rxdata"] });
    render(<OpenScreen />);
    const recentTab = screen.getByRole("tab", { name: /Partidas recientes/ });
    expect(recentTab.getAttribute("aria-selected")).toBe("true");
    expect(recentTab.textContent).toContain("2");
    expect(screen.getByText("Uno.rxdata")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Quitar")[0]!);
    expect(useSettings.getState().recent).toEqual(["/s/Dos.rxdata"]);
    fireEvent.click(screen.getByLabelText("Quitar"));
    // Sin partidas la pestaña sigue siendo la de recientes y lo explica
    expect(screen.getByRole("tab", { name: /Partidas recientes/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("recent-empty")).toBeTruthy();
  });

  it("sin recientes ni elección entra en «Juegos guardados» y muestra el botón de agregar", () => {
    render(<OpenScreen />);
    expect(screen.getByRole("tab", { name: /Juegos guardados/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Agregar directorio de juego" })).toBeTruthy();
    expect(screen.getByText(/Aún no has agregado ningún juego/)).toBeTruthy();
  });

  it("al cambiar de pestaña se recuerda la elección en los ajustes", () => {
    useSettings.setState({ recent: ["/s/Uno.rxdata"] });
    useGames.setState({ games: [game("a"), game("b")] });
    render(<OpenScreen />);
    expect(screen.getByRole("tab", { name: /Juegos guardados/ }).textContent).toContain("2");
    fireEvent.click(screen.getByRole("tab", { name: /Juegos guardados/ }));
    expect(useSettings.getState().openTab).toBe("games");
    expect(screen.getByTestId("game-library")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Partidas recientes/ }));
    expect(useSettings.getState().openTab).toBe("recent");
  });

  it("el panel está enlazado con su tab y mientras abre una partida no hay tabs", async () => {
    useSettings.setState({ recent: ["/s/Uno.rxdata"] });
    const { rerender } = render(<OpenScreen />);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: /Partidas recientes/ }).id);
    useSession.setState({ opening: true });
    rerender(<OpenScreen />);
    await waitFor(() => expect(screen.queryByRole("tablist")).toBeNull());
  });

  it("el botón Ajustes abre los ajustes del inicio, sin necesidad de una partida", () => {
    render(<OpenScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(useUi.getState().homeSettingsOpen).toBe(true);
  });

  it("el botón de actualización está oculto salvo que haya una versión nueva, y al pulsarlo abre el diálogo", () => {
    const { rerender } = render(<OpenScreen />);
    expect(screen.queryByTestId("update-badge")).toBeNull();

    const release = { tag: "v9.9.9", version: "9.9.9", name: "PESHeX 9.9.9", notes: "", url: "https://x", publishedAt: null, prerelease: false, asset: { name: "a.zip", url: "https://x/a.zip", size: 1 }, sumsUrl: "https://x/s" };
    useUpdater.setState({ release, phase: "available", dialogOpen: false });
    rerender(<OpenScreen />);
    const pill = screen.getByTestId("update-badge");
    expect(pill.textContent).toContain("Nueva versión 9.9.9 disponible");
    fireEvent.click(pill);
    expect(useUpdater.getState().dialogOpen).toBe(true);

    // Con el diálogo abierto el botón se oculta (no se duplica)
    rerender(<OpenScreen />);
    expect(screen.queryByTestId("update-badge")).toBeNull();
  });

  it("el botón de actualización cambia su texto cuando la descarga está lista", () => {
    const release = { tag: "v9.9.9", version: "9.9.9", name: "PESHeX 9.9.9", notes: "", url: "https://x", publishedAt: null, prerelease: false, asset: { name: "a.zip", url: "https://x/a.zip", size: 1 }, sumsUrl: "https://x/s" };
    useUpdater.setState({ release, phase: "ready", dialogOpen: false });
    render(<OpenScreen />);
    expect(screen.getByTestId("update-badge").textContent).toContain("Instalar la 9.9.9 y reiniciar");
  });
});
