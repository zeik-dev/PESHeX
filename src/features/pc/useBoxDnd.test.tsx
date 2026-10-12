import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBoxDnd } from "./useBoxDnd";

afterEach(() => vi.restoreAllMocks());

function el(attrs: Record<string, string>): Element {
  const div = document.createElement("div");
  for (const [k, v] of Object.entries(attrs)) div.setAttribute(k, v);
  const child = document.createElement("span");
  div.appendChild(child);
  return child; // el puntero esta sobre un hijo: closest() debe subir hasta el destino
}

function ptr(type: string, x: number, y: number) {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}
const down = (x: number, y: number) =>
  ({ button: 0, pointerType: "mouse", clientX: x, clientY: y }) as unknown as React.PointerEvent;

describe("useBoxDnd (punteros)", () => {
  it("un movimiento menor al umbral es un clic, no un arrastre", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useBoxDnd({ onDrop, elementFromPoint: () => el({ "data-drop": "box/0/1" }) }));
    act(() => result.current.dragProps("box/0/0").onPointerDown(down(10, 10)));
    act(() => ptr("pointermove", 12, 11));
    act(() => ptr("pointerup", 12, 11));
    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current.drag).toBeNull();
    expect(result.current.wasDragged()).toBe(false);
  });

  it("arrastrar y soltar sobre una casilla llama a onDrop(origen, destino)", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useBoxDnd({ onDrop, elementFromPoint: () => el({ "data-drop": "box/2/7" }) }));
    act(() => result.current.dragProps("party/1").onPointerDown(down(0, 0)));
    act(() => ptr("pointermove", 30, 30));
    expect(result.current.drag).toEqual({ ref: "party/1", over: "box/2/7" });
    expect(result.current.wasDragged()).toBe(true); // el clic que sigue al arrastre se ignora
    act(() => ptr("pointerup", 30, 30));
    expect(onDrop).toHaveBeenCalledWith("party/1", "box/2/7");
    expect(result.current.drag).toBeNull();
  });

  it("soltar fuera de cualquier casilla, o sobre la de origen, no hace nada", () => {
    const onDrop = vi.fn();
    let target: Element | null = null;
    const { result } = renderHook(() => useBoxDnd({ onDrop, elementFromPoint: () => target }));
    act(() => result.current.dragProps("box/0/0").onPointerDown(down(0, 0)));
    act(() => ptr("pointermove", 40, 0));
    act(() => ptr("pointerup", 40, 0));
    target = el({ "data-drop": "box/0/0" });
    act(() => result.current.dragProps("box/0/0").onPointerDown(down(0, 0)));
    act(() => ptr("pointermove", 40, 0));
    act(() => ptr("pointerup", 40, 0));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("Escape cancela el arrastre", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useBoxDnd({ onDrop, elementFromPoint: () => el({ "data-drop": "box/0/3" }) }));
    act(() => result.current.dragProps("box/0/0").onPointerDown(down(0, 0)));
    act(() => ptr("pointermove", 40, 0));
    expect(result.current.drag).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(result.current.drag).toBeNull();
    act(() => ptr("pointerup", 40, 0));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("solo el boton principal del raton arrastra", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useBoxDnd({ onDrop, elementFromPoint: () => el({ "data-drop": "box/0/3" }) }));
    act(() => result.current.dragProps("box/0/0").onPointerDown({ ...down(0, 0), button: 2 } as unknown as React.PointerEvent));
    act(() => ptr("pointermove", 40, 0));
    expect(result.current.drag).toBeNull();
  });
});

describe("useBoxDnd (teclado)", () => {
  const key = (k: string) => ({ key: k, preventDefault: () => undefined, stopPropagation: () => undefined }) as unknown as React.KeyboardEvent;

  it("Espacio agarra, Espacio en otra casilla suelta, Esc cancela", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useBoxDnd({ onDrop }));
    act(() => void result.current.onCellKey(key(" "), "box/0/0", "box/0/0"));
    expect(result.current.grab).toBe("box/0/0");
    act(() => void result.current.onCellKey(key(" "), null, "box/0/1"));
    expect(onDrop).toHaveBeenCalledWith("box/0/0", "box/0/1");
    expect(result.current.grab).toBeNull();

    act(() => void result.current.onCellKey(key(" "), "box/0/2", "box/0/2"));
    act(() => void result.current.onCellKey(key("Escape"), "box/0/3", "box/0/3"));
    expect(result.current.grab).toBeNull();
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("Espacio sobre una casilla vacia sin nada agarrado no hace nada; soltar sobre la propia casilla tampoco mueve", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useBoxDnd({ onDrop }));
    act(() => void result.current.onCellKey(key(" "), null, "box/0/5"));
    expect(result.current.grab).toBeNull();
    act(() => void result.current.onCellKey(key(" "), "box/0/0", "box/0/0"));
    act(() => void result.current.onCellKey(key(" "), "box/0/0", "box/0/0"));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("otras teclas no se consumen", () => {
    const { result } = renderHook(() => useBoxDnd({ onDrop: vi.fn() }));
    expect(result.current.onCellKey(key("ArrowRight"), "box/0/0", "box/0/0")).toBe(false);
  });
});
