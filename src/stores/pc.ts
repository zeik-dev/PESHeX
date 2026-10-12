import { create } from "zustand";

/** Estado de la pantalla PC/Equipo que debe sobrevivir al cambiar de pestana. */
interface PcState {
  /** Caja que se esta viendo (null = la actual del save). */
  box: number | null;
  /** Pokemon seleccionado (ref) o casilla vacia seleccionada (ref de destino). */
  selected: string | null;
  /** Filtro "solo ilegales" del PC. */
  onlyIllegal: boolean;
  setOnlyIllegal: (v: boolean) => void;
  setBox: (box: number | null) => void;
  select: (ref: string | null) => void;
  reset: () => void;
}

export const usePc = create<PcState>((set) => ({
  box: null,
  selected: null,
  onlyIllegal: false,
  setOnlyIllegal: (onlyIllegal) => set({ onlyIllegal }),
  setBox: (box) => set({ box }),
  select: (selected) => set({ selected }),
  reset: () => set({ box: null, selected: null, onlyIllegal: false }),
}));
