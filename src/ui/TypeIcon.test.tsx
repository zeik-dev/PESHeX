import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { initI18n } from "../i18n";
import { AssetIndex } from "../game/assetIndex";
import { detectLayout } from "../game/layout";
import { indexCatalog } from "../game/lookup";
import type { Catalog, ScanFile } from "../game/types";
import { useGame } from "../stores/game";
import { GenderIcon } from "./GenderIcon";
import { PokemonIcon } from "./GameImage";
import { TypeIcon } from "./TypeIcon";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://localhost/${p}`, invoke: vi.fn() }));

beforeAll(() => {
  initI18n("es");
});
afterEach(() => {
  cleanup();
  useGame.setState({ ctx: null, catalogIndex: null, status: { linked: false, legality: { level: "basic", reasons: [] } } });
});

const EMPTY: Catalog = { species: [], moves: [], items: [], abilities: [], types: [], natures: [] };

function withGame(files: ScanFile[], catalog: Partial<Catalog> = {}) {
  const index = new AssetIndex(files);
  useGame.setState({
    ctx: { index, layout: detectLayout(index), map: null },
    catalogIndex: indexCatalog({ ...EMPTY, ...catalog }),
    status: { linked: true, root: "/juego", legality: { level: "basic", reasons: [] } },
  });
}

describe("TypeIcon", () => {
  it("con types.png recorta la fila del tipo según su IconPosition", () => {
    withGame([["Graphics/Pictures/types.png", 64, 672]], { types: [{ id: "FIRE", name: "Fuego", iconPosition: 10 }] });
    render(<TypeIcon type="FIRE" height={14} />);
    const icon = screen.getByRole("img", { name: "Fuego" });
    expect(icon.getAttribute("data-source")).toBe("game");
    const img = icon.querySelector("img")!;
    expect(img.style.height).toBe("336px"); // 24 cuadros de 14 px
    expect(img.style.marginTop).toBe("-140px"); // la fila 10
  });

  it("sin hoja (o sin posición) usa una etiqueta propia con las 3 primeras letras", () => {
    render(<TypeIcon type="WATER" />);
    const icon = screen.getByRole("img", { name: "Water" });
    expect(icon.getAttribute("data-source")).toBe("own");
    expect(icon.textContent).toBe("WAT");
  });

  it("sin tipo no pinta nada", () => {
    const { container } = render(<TypeIcon type={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("GenderIcon", () => {
  it("lleva el nombre del género y no depende de la carpeta del juego", () => {
    render(<><GenderIcon gender={0} /><GenderIcon gender={1} /><GenderIcon gender={2} /><GenderIcon gender={null} /></>);
    expect(screen.getByRole("img", { name: "Macho" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Hembra" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Sin género" })).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });
});

describe("PokemonIcon en bases numeradas", () => {
  it("encuentra el icono por el numero de la especie aunque solo reciba el id de texto (evoluciones de la Pokédex)", () => {
    withGame([["Graphics/Icons/icon059.png", 128, 64], ["Graphics/Icons/item001.png", 24, 24]], {
      species: [{ id: "ARCANINE", species: "ARCANINE", form: 0, name: "Arcanine", formName: null, types: [], number: 59, order: 59 }],
    });
    render(<PokemonIcon name="Arcanine" species="ARCANINE" size={28} />);
    expect(screen.getByRole("img", { name: "Arcanine", hidden: true }).getAttribute("src")).toContain("icon059.png");
  });

  it("sin el numero ni el catalogo cae al marcador de color", () => {
    withGame([["Graphics/Icons/icon059.png", 128, 64]]);
    const { container } = render(<PokemonIcon name="Arcanine" species="ARCANINE" size={28} />);
    expect(container.querySelector("img")).toBeNull();
  });
});
