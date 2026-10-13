import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComboBox, type ComboOption } from "./combobox";

afterEach(cleanup);

const many: ComboOption[] = Array.from({ length: 300 }, (_, i) => ({ id: `M${i}`, label: `Mov ${String(i).padStart(3, "0")}` }));

function open(limit?: number, value = "") {
  render(<ComboBox ariaLabel="Movimiento" value={value} options={many} onChange={vi.fn()} limit={limit} />);
  const input = screen.getByRole("combobox", { name: "Movimiento" });
  fireEvent.focus(input);
  return input;
}

describe("ComboBox", () => {
  it("por defecto lista como mucho 60 resultados", () => {
    open();
    expect(screen.getAllByRole("option")).toHaveLength(60);
  });

  it("con limit=Infinity lista TODAS las opciones, también al escribir", () => {
    const input = open(Infinity);
    expect(screen.getAllByRole("option")).toHaveLength(300);
    fireEvent.change(input, { target: { value: "Mov" } });
    expect(screen.getAllByRole("option")).toHaveLength(300);
    fireEvent.change(input, { target: { value: "Mov 29" } });
    expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(10);
    expect(screen.getAllByRole("option").length).toBeLessThan(300);
  });

  it("al abrir sin escribir deja activa la opción del valor actual", () => {
    open(Infinity, "M150");
    const active = screen.getByRole("combobox", { name: "Movimiento" }).getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.textContent).toContain("Mov 150");
  });
});
