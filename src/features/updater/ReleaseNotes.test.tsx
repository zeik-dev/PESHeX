import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReleaseNotes } from "./ReleaseNotes";

describe("ReleaseNotes", () => {
  it("pinta titulos, listas, negrita y codigo", () => {
    render(<ReleaseNotes notes={"## PESHeX\n### Novedades\n- **Biblioteca** de juegos\n- usa `Game.ini`\n\nTexto suelto"} />);
    expect(screen.getByRole("heading", { name: "Novedades" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Biblioteca").tagName).toBe("STRONG");
    expect(screen.getByText("Game.ini").tagName).toBe("CODE");
    expect(screen.getByText("Texto suelto")).toBeTruthy();
  });

  it("nunca interpreta HTML de las notas (vienen de internet)", () => {
    const { container } = render(<ReleaseNotes notes={'- <img src=x onerror="alert(1)"> y <script>alert(2)</script>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });
});
