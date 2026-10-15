import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tabs, tabId, tabPanelId } from "./controls";

const TABS = [
  { id: "a", label: "Uno", badge: 3 },
  { id: "b", label: "Dos" },
  { id: "c", label: "Tres" },
];

function Harness({ onChange }: { onChange?: (id: string) => void }) {
  const [v, setV] = useState("a");
  return (
    <Tabs
      idPrefix="t"
      ariaLabel="Pruebas"
      tabs={TABS}
      value={v}
      onChange={(id) => {
        setV(id);
        onChange?.(id);
      }}
    />
  );
}

afterEach(cleanup);

describe("Tabs", () => {
  it("expone tablist, tabs, selección, ids y aria-controls", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Pruebas" })).toBeTruthy();
    const a = screen.getByRole("tab", { name: /Uno/ });
    expect(a.getAttribute("aria-selected")).toBe("true");
    expect(a.id).toBe(tabId("t", "a"));
    expect(a.getAttribute("aria-controls")).toBe(tabPanelId("t", "a"));
    expect(screen.getByRole("tab", { name: /Dos/ }).getAttribute("aria-selected")).toBe("false");
    expect(a.textContent).toContain("3"); // el conteo
  });

  it("solo el tab activo entra en el orden de tabulación", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: /Uno/ }).getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("tab", { name: /Dos/ }).getAttribute("tabindex")).toBe("-1");
  });

  it("las flechas, Inicio y Fin activan otro tab, le pasan el foco y dan la vuelta", () => {
    const changed = vi.fn();
    render(<Harness onChange={changed} />);
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(changed).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Dos/ }));
    fireEvent.keyDown(list, { key: "End" });
    expect(changed).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(list, { key: "ArrowRight" }); // da la vuelta al principio
    expect(changed).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(list, { key: "ArrowLeft" }); // y al final hacia atrás
    expect(changed).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(list, { key: "Home" });
    expect(changed).toHaveBeenLastCalledWith("a");
  });

  it("otras teclas no hacen nada y el clic sigue funcionando", () => {
    const changed = vi.fn();
    render(<Harness onChange={changed} />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "a" });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: /Tres/ }));
    expect(changed).toHaveBeenCalledWith("c");
  });
});
