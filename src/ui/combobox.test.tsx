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

describe("ComboBox: iconos, contenido a la derecha y texto de búsqueda", () => {
  const opts: ComboOption[] = [
    { id: "ADAMANT", label: "Firme", icon: <i data-testid="icon-adamant" />, right: <b data-testid="right-adamant">+Atq −AtE</b>, search: "Ataque" },
    { id: "BOLD", label: "Osada", icon: <i data-testid="icon-bold" />, right: <b data-testid="right-bold">+Def −Atq</b>, search: "Defensa" },
  ];

  it("el campo cerrado muestra el icono y lo de la derecha de la opción elegida", () => {
    render(<ComboBox ariaLabel="Naturaleza" value="BOLD" options={opts} onChange={vi.fn()} />);
    expect(screen.getByTestId("icon-bold")).toBeTruthy();
    expect(screen.getByTestId("right-bold")).toBeTruthy();
    expect(screen.queryByTestId("icon-adamant")).toBeNull();
  });

  it("al abrir, cada fila lleva su contenido a la derecha", () => {
    render(<ComboBox ariaLabel="Naturaleza" value="BOLD" options={opts} onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Naturaleza" }));
    const rows = screen.getAllByRole("option");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("+Atq −AtE");
  });

  it("busca por el texto extra (`search`) aunque no se vea", () => {
    render(<ComboBox ariaLabel="Naturaleza" value="" options={opts} onChange={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Naturaleza" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "defensa" } });
    const rows = screen.getAllByRole("option");
    expect(rows[0].textContent).toContain("Osada");
  });

  it("al escribir otra cosa el icono de la opción elegida se oculta", () => {
    render(<ComboBox ariaLabel="Naturaleza" value="BOLD" options={opts} onChange={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Naturaleza" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Fir" } });
    expect(screen.queryByTestId("icon-bold")).toBeNull();
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
