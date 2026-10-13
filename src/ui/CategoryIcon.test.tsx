import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { initI18n } from "../i18n";
import { AssetIndex } from "../game/assetIndex";
import { detectLayout } from "../game/layout";
import type { ScanFile } from "../game/types";
import { useGame } from "../stores/game";
import { CategoryIcon } from "./CategoryIcon";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://localhost/${p}`, invoke: vi.fn() }));

beforeAll(() => {
  initI18n("es");
});
afterEach(() => {
  cleanup();
  useGame.setState({ ctx: null, status: { linked: false, legality: { level: "basic", reasons: [] } } });
});

function withGame(files: ScanFile[]) {
  const index = new AssetIndex(files);
  useGame.setState({ ctx: { index, layout: detectLayout(index), map: null }, status: { linked: true, root: "/juego", legality: { level: "basic", reasons: [] } } });
}

describe("CategoryIcon", () => {
  it("sin hoja del juego usa el ícono propio, con el nombre de la categoría accesible", () => {
    render(<>{[0, 1, 2].map((c) => <CategoryIcon key={c} category={c} />)}</>);
    expect(screen.getByRole("img", { name: "Físico" }).getAttribute("data-source")).toBe("own");
    expect(screen.getByRole("img", { name: "Especial" }).querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("img", { name: "Estado" }).getAttribute("title")).toBe("Estado");
  });

  it("con category.png en el juego recorta el cuadro de su categoría", () => {
    withGame([["Graphics/Pictures/category.png", 64, 84]]);
    render(<CategoryIcon category={1} height={14} />);
    const icon = screen.getByRole("img", { name: "Especial" });
    expect(icon.getAttribute("data-source")).toBe("game");
    const img = icon.querySelector("img")!;
    expect(img.style.height).toBe("42px"); // 3 cuadros de 14 px
    expect(img.style.marginTop).toBe("-14px"); // el segundo cuadro
    expect(img.getAttribute("src")).toBe("asset://localhost//juego/Graphics/Pictures/category.png"); // asset protocol
  });

  it("una categoría desconocida no pinta nada", () => {
    const { container } = render(<><CategoryIcon category={null} /><CategoryIcon category={9} /></>);
    expect(container.firstChild).toBeNull();
  });
});
