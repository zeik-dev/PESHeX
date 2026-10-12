import { create } from "zustand";
import type { WorldKind } from "../api/types";

/** Estado de interfaz compartido entre vistas: paleta de comandos y destino de navegacion al mundo. */
interface UiState {
  paletteOpen: boolean;
  setPalette: (open: boolean) => void;
  togglePalette: () => void;
  /** Importar Pokemon (dialogo global, se abre desde el PC o la paleta). */
  importOpen: boolean;
  setImportOpen: (open: boolean) => void;
  /** Exportar el Pokemon con este ref (null = cerrado). */
  exportRef: string | null;
  setExportRef: (ref: string | null) => void;
  /** Destino al abrir "Mundo" desde la busqueda global. */
  worldTarget: { kind: WorldKind; q: string } | null;
  setWorldTarget: (t: { kind: WorldKind; q: string } | null) => void;
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  importOpen: false,
  setImportOpen: (importOpen) => set({ importOpen }),
  exportRef: null,
  setExportRef: (exportRef) => set({ exportRef }),
  worldTarget: null,
  setWorldTarget: (worldTarget) => set({ worldTarget }),
}));
