import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComboBox, placeDropdown, type ComboOption } from "./combobox";

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

describe("placeDropdown: el desplegable no se sale de la ventana", () => {
  const view = { width: 1000, height: 700 };
  const field = (top: number, left = 100, width = 200) => ({ left, width, top, bottom: top + 32 });

  it("abre hacia abajo cuando cabe", () => {
    const p = placeDropdown(field(100), view, 500);
    expect(p.up).toBe(false);
    expect(p.top).toBe(134);
    expect(p.bottom).toBeUndefined();
    expect(p.maxHeight).toBe(320);
  });

  it("abre hacia arriba cuando abajo no cabe y arriba hay más sitio (4.º movimiento de la última fila)", () => {
    const p = placeDropdown(field(640), view, 500);
    expect(p.up).toBe(true);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(700 - 640 + 2); // pegado al borde superior del campo
    expect(p.maxHeight).toBe(320);
  });

  it("limita el alto al espacio libre del lado elegido", () => {
    const p = placeDropdown(field(200), { width: 1000, height: 420 }, 500); // abajo 420-232-10=178, arriba 190
    expect(p.up).toBe(true);
    expect(p.maxHeight).toBe(190);
    const q = placeDropdown(field(60), { width: 1000, height: 300 }, 500); // abajo 198, arriba 50
    expect(q.up).toBe(false);
    expect(q.maxHeight).toBe(198);
  });

  it("una lista corta que cabe abajo no se invierte", () => {
    expect(placeDropdown(field(640), view, 20).up).toBe(true); // ni 20 px caben: 700-672-10 = 18
    expect(placeDropdown(field(600), view, 40).up).toBe(false);
  });

  it("mantiene el lado ya elegido mientras siga cabiendo", () => {
    expect(placeDropdown(field(300), view, 100, "up").up).toBe(true);
    expect(placeDropdown(field(300), view, 100, "down").up).toBe(false);
    expect(placeDropdown(field(640), view, 100, "down").up).toBe(true); // abajo ya no cabe
  });

  it("no se sale por los lados", () => {
    expect(placeDropdown(field(100, 900, 200), view, 100).left).toBe(752); // ancho mínimo 240: 1000 - 240 - 8
    expect(placeDropdown(field(100, 2, 200), view, 100).left).toBe(8);
    expect(placeDropdown(field(100, 100, 600), { width: 400, height: 700 }, 100).width).toBe(384);
  });
});

describe("ComboBox cerca del borde inferior", () => {
  it("se abre hacia arriba y dentro de la ventana", () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 50, top: 660, bottom: 692, right: 250, width: 200, height: 32, x: 50, y: 660, toJSON: () => ({}) });
    const heightSpy = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);
    Object.defineProperty(window, "innerHeight", { value: 700, configurable: true });
    try {
      open(Infinity);
      const list = screen.getByRole("listbox");
      expect(list.getAttribute("data-side")).toBe("up");
      expect(list.style.bottom).toBe("42px");
      expect(list.style.top).toBe("");
      expect(list.style.maxHeight).toBe("320px");
    } finally {
      rectSpy.mockRestore();
      heightSpy.mockRestore();
    }
  });
});
