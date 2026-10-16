import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined), revealItemInDir: vi.fn() }));
vi.mock("../../api/games", () => ({
  gamesApi: { list: vi.fn(async () => []), scanSaves: vi.fn(async () => null), preloading: vi.fn(async () => []) },
  onPreload: vi.fn(async () => () => undefined),
}));

import { openUrl } from "@tauri-apps/plugin-opener";
import App from "../../app/App";
import { initI18n } from "../../i18n";
import { useGames } from "../../stores/games";
import { useSession } from "../../stores/session";
import { useSettings } from "../../stores/settings";
import { resetUpdaterForTests, useUpdater } from "../../stores/updater";
import { useUi } from "../../stores/ui";
import { HomeSettings } from "./HomeSettings";

afterEach(() => {
  cleanup();
  resetUpdaterForTests();
  useUi.setState({ homeSettingsOpen: false });
});

beforeEach(() => {
  initI18n("es");
  useSettings.setState({ recent: [], openTab: null });
  useGames.setState({ games: [], loaded: true, scans: {}, preload: {} });
  useSession.setState({ filePath: null, opening: false, openError: null });
  useUi.setState({ homeSettingsOpen: true });
});

describe("HomeSettings", () => {
  it("enseña solo lo que no depende de una partida: apariencia, zoom, juegos, actualizaciones y datos de la app", () => {
    render(<HomeSettings />);
    expect(screen.getByText("Idioma")).toBeTruthy();
    expect(screen.getByText("Tema")).toBeTruthy();
    expect(screen.getByText("Actualizaciones")).toBeTruthy();
    expect(screen.getByText("Acerca de")).toBeTruthy();
    // Lo de una partida abierta no aparece
    expect(screen.queryByText("Detección de la base")).toBeNull();
    expect(screen.queryByText("Carpeta del juego")).toBeNull();
  });

  it("«Acerca de» da la versión, el autor, la licencia y enlaces al proyecto", () => {
    render(<HomeSettings />);
    const about = screen.getByTestId("about-details");
    expect(about.textContent).toContain("Randy A. Germosén (zeik-dev)");
    expect(about.textContent).toContain("MIT");
    fireEvent.click(screen.getByRole("button", { name: /Versiones publicadas/ }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/zeik-dev/PESHeX/releases");
  });

  it("«Atrás» cierra los ajustes del inicio", () => {
    render(<HomeSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    expect(useUi.getState().homeSettingsOpen).toBe(false);
  });

  it("la app enseña los ajustes en vez de la pantalla de inicio y vuelve con «Atrás»", () => {
    useUpdater.setState({ supported: false });
    render(<App />);
    expect(screen.getByTestId("home-settings")).toBeTruthy();
    expect(screen.queryByTestId("open-tabs")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    expect(screen.queryByTestId("home-settings")).toBeNull();
    expect(screen.getByTestId("open-tabs")).toBeTruthy();
  });
});
