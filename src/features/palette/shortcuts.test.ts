import { describe, expect, it } from "vitest";
import { isTextEditing, shortcutFor } from "./ShortcutsHost";

const key = (k: string, o: Record<string, unknown> = {}, tag = "BODY") =>
  ({ ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: k, target: { tagName: tag, isContentEditable: false, ...(o.target as object) }, ...o }) as never;

describe("shortcutFor", () => {
  it("Ctrl+K, Ctrl+S, Ctrl+Z, Ctrl+Y y Ctrl+Mayus+Z", () => {
    expect(shortcutFor(key("k"))).toBe("palette");
    expect(shortcutFor(key("K"))).toBe("palette");
    expect(shortcutFor(key("s"))).toBe("save");
    expect(shortcutFor(key("z"))).toBe("undo");
    expect(shortcutFor(key("y"))).toBe("redo");
    expect(shortcutFor(key("z", { shiftKey: true }))).toBe("redo");
  });

  it("en Mac usa Cmd", () => {
    expect(shortcutFor(key("z", { ctrlKey: false, metaKey: true }))).toBe("undo");
  });

  it("sin Ctrl/Cmd, con Alt o con otras teclas no hace nada", () => {
    expect(shortcutFor(key("z", { ctrlKey: false }))).toBeNull();
    expect(shortcutFor(key("z", { altKey: true }))).toBeNull();
    expect(shortcutFor(key("c"))).toBeNull();
  });

  it("dentro de un campo de texto deja a Ctrl+Z/Y deshacer el texto, pero Ctrl+S y Ctrl+K siguen", () => {
    expect(shortcutFor(key("z", {}, "INPUT"))).toBeNull();
    expect(shortcutFor(key("y", {}, "TEXTAREA"))).toBeNull();
    expect(shortcutFor(key("s", {}, "INPUT"))).toBe("save");
    expect(shortcutFor(key("k", {}, "INPUT"))).toBe("palette");
  });
});

describe("isTextEditing", () => {
  it("distingue campos de texto de casillas y botones", () => {
    expect(isTextEditing({ tagName: "INPUT", type: "text" } as never)).toBe(true);
    expect(isTextEditing({ tagName: "INPUT", type: "number" } as never)).toBe(true);
    expect(isTextEditing({ tagName: "INPUT", type: "checkbox" } as never)).toBe(false);
    expect(isTextEditing({ tagName: "BUTTON" } as never)).toBe(false);
    expect(isTextEditing({ tagName: "DIV", isContentEditable: true } as never)).toBe(true);
    expect(isTextEditing(null)).toBe(false);
  });
});
