import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu } from "./menu";
import { placePopover } from "./popover";
import { SliderField } from "./slider";
import { LoadProgress } from "./LoadProgress";

afterEach(cleanup);

describe("SliderField", () => {
  it("arrastrar solo cambia la vista; el cambio se confirma una vez al soltar", () => {
    const onCommit = vi.fn();
    render(<SliderField value={10} min={0} max={31} onCommit={onCommit} ariaLabel="IV PS" />);
    const slider = screen.getByRole("slider", { name: "IV PS (deslizador)" }) as HTMLInputElement;
    const number = screen.getByRole("textbox", { name: "IV PS" }) as HTMLInputElement;

    fireEvent.change(slider, { target: { value: "20" } });
    fireEvent.change(slider, { target: { value: "25" } });
    expect(onCommit).not.toHaveBeenCalled();
    expect(number.value).toBe("25");

    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(25);
  });

  it("con el teclado confirma al levantar la tecla y un valor sin cambios no confirma", () => {
    const onCommit = vi.fn();
    render(<SliderField value={5} min={0} max={10} onCommit={onCommit} ariaLabel="Felicidad" />);
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(slider, { target: { value: "6" } });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenCalledWith(6);
  });

  it("el campo numerico admite valores fuera del recorrido del deslizador (0 PS = debilitado)", () => {
    const onCommit = vi.fn();
    render(<SliderField value={40} min={1} max={100} numberMin={0} onCommit={onCommit} ariaLabel="PS" />);
    const number = screen.getByRole("textbox", { name: "PS" }) as HTMLInputElement;
    fireEvent.change(number, { target: { value: "0" } });
    fireEvent.blur(number);
    expect(onCommit).toHaveBeenCalledWith(0);
    expect((screen.getByRole("slider") as HTMLInputElement).min).toBe("1");
  });
});

describe("placePopover", () => {
  const viewport = { width: 1000, height: 700 };
  const size = { width: 200, height: 150 };
  const anchor = { left: 600, right: 700, top: 100, bottom: 130, width: 100, height: 30 } as DOMRect;

  it("se abre hacia la izquierda del boton", () => {
    const pos = placePopover("left", size, viewport, anchor, null);
    expect(pos.left + size.width).toBeLessThan(anchor.left);
    expect(pos.top).toBe(anchor.top);
  });

  it("si no cabe a la izquierda pasa a la derecha", () => {
    const edge = { ...anchor, left: 20, right: 120 } as DOMRect;
    expect(placePopover("left", size, viewport, edge, null).left).toBeGreaterThanOrEqual(edge.right);
  });

  it("no se sale del viewport (clic derecho cerca de la esquina)", () => {
    const pos = placePopover("point", size, viewport, null, { x: 990, y: 690 });
    expect(pos.left + size.width).toBeLessThanOrEqual(viewport.width);
    expect(pos.top + size.height).toBeLessThanOrEqual(viewport.height);
  });
});

describe("ContextMenu", () => {
  const items = (spy: () => void) => [
    { id: "edit", label: "Editar", onSelect: spy },
    { id: "clone", label: "Clonar", onSelect: () => undefined, disabled: true },
    { id: "del", label: "Eliminar", onSelect: () => undefined, danger: true },
  ];

  it("muestra los elementos como menuitem y ejecuta el elegido cerrando el menu", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu open point={{ x: 10, y: 10 }} items={items(onSelect)} label="Acciones" onClose={onClose} />);
    expect(screen.getByRole("menu", { name: "Acciones" })).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    expect((screen.getByRole("menuitem", { name: "Clonar" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("las flechas saltan los deshabilitados y Escape cierra", () => {
    const onClose = vi.fn();
    render(<ContextMenu open point={{ x: 10, y: 10 }} items={items(() => undefined)} label="Acciones" onClose={onClose} />);
    const edit = screen.getByRole("menuitem", { name: "Editar" });
    edit.focus();
    fireEvent.keyDown(edit, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Eliminar" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(document.activeElement).toBe(edit);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("cerrado no pinta nada", () => {
    render(<ContextMenu open={false} point={null} items={[]} label="Acciones" onClose={() => undefined} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("LoadProgress", () => {
  it("expone el porcentaje a las tecnologias de apoyo y lo acota a 0-100", () => {
    const { rerender } = render(<LoadProgress value={0.426} label="Leyendo especies" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("43");
    expect(bar.getAttribute("aria-valuetext")).toBe("Leyendo especies (43 %)");
    rerender(<LoadProgress value={3} label="x" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    rerender(<LoadProgress value={-1} label="x" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });
});
