import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NumberField, TextField } from "./controls";

afterEach(cleanup);

describe("NumberField", () => {
  it("confirma al salir del campo solo si el valor cambio y es entero", () => {
    const onCommit = vi.fn();
    render(<NumberField value={10} onCommit={onCommit} ariaLabel="n" />);
    const input = screen.getByLabelText("n") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(42);

    fireEvent.change(input, { target: { value: "4.5" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("10");
  });

  it("Escape revierte el texto", () => {
    render(<NumberField value={7} onCommit={() => undefined} ariaLabel="n" />);
    const input = screen.getByLabelText("n") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("7");
  });
});

describe("TextField", () => {
  it("un texto vacio es null cuando el campo lo admite", () => {
    const onCommit = vi.fn();
    render(<TextField value="Rayo" nullable onCommit={onCommit} ariaLabel="t" />);
    const input = screen.getByLabelText("t");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("un texto vacio se descarta cuando no admite null", () => {
    const onCommit = vi.fn();
    render(<TextField value="Rayo" onCommit={onCommit} ariaLabel="t" />);
    const input = screen.getByLabelText("t") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("Rayo");
  });
});
