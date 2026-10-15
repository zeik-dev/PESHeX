import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip, placeTooltip } from "./Tooltip";

afterEach(cleanup);

describe("Tooltip", () => {
  it("aparece al pasar el ratón y se enlaza con aria-describedby", () => {
    render(
      <Tooltip content="+32 por EV (252)">
        <button type="button">EV</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(screen.getByText("EV"));
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("+32 por EV (252)");
    expect(screen.getByText("EV").parentElement?.getAttribute("aria-describedby")).toBe(tip.id);
    fireEvent.mouseLeave(screen.getByText("EV"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("también al enfocar y se cierra con Escape", () => {
    render(
      <Tooltip content="ayuda" focusable>
        <span>x</span>
      </Tooltip>,
    );
    const anchor = screen.getByText("x").parentElement!;
    fireEvent.focus(anchor);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(anchor, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("placeTooltip", () => {
  const view = { width: 800, height: 600 };
  it("va centrado por encima del elemento", () => {
    const p = placeTooltip({ left: 300, top: 300, bottom: 320, width: 40 }, { width: 100, height: 30 }, view);
    expect(p).toEqual({ left: 270, top: 264, below: false });
  });
  it("pasa por debajo si arriba no cabe", () => {
    const p = placeTooltip({ left: 300, top: 10, bottom: 30, width: 40 }, { width: 100, height: 30 }, view);
    expect(p.below).toBe(true);
    expect(p.top).toBe(36);
  });
  it("no se sale por los lados", () => {
    expect(placeTooltip({ left: 0, top: 300, bottom: 320, width: 10 }, { width: 100, height: 30 }, view).left).toBe(6);
    expect(placeTooltip({ left: 795, top: 300, bottom: 320, width: 10 }, { width: 100, height: 30 }, view).left).toBe(694);
  });
});
