import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "../../i18n";
import { resetUpdaterForTests, useUpdater } from "../../stores/updater";
import { UpdateStatus } from "./UpdateStatus";

beforeEach(() => {
  initI18n("es");
  resetUpdaterForTests();
});
afterEach(() => {
  cleanup();
  resetUpdaterForTests();
});

describe("UpdateStatus", () => {
  it("sin aviso no pinta nada", () => {
    render(<UpdateStatus />);
    expect(screen.queryByTestId("update-status")).toBeNull();
  });

  it("buscando, al dia y con error", () => {
    render(<UpdateStatus />);
    act(() => useUpdater.setState({ notice: { kind: "checking" } }));
    expect(screen.getByRole("status").textContent).toBe("Buscando actualizaciones…");

    act(() => useUpdater.setState({ notice: { kind: "upToDate", version: "1.2.2" } }));
    expect(screen.getByRole("status").textContent).toBe("Estás al día");
    expect(screen.getByRole("status").getAttribute("title")).toContain("1.2.2");

    act(() => useUpdater.setState({ notice: { kind: "error", code: "network", message: "sin red" } }));
    expect(screen.getByRole("status").textContent).toBe("No se pudo buscar actualizaciones");
    expect(screen.getByRole("status").getAttribute("title")).toContain("sin red");
  });
});
