import { create } from "zustand";
import i18n from "../i18n";
import { onSaveChanged, toApiError } from "../api/tauri";
import { errorText } from "../lib/errors";
import { useSession } from "./session";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";

/** Intentos de recarga y espera entre ellos: el juego puede seguir escribiendo cuando Rust avisa. */
const ATTEMPTS = 3;
const RETRY_MS = 1500;

interface SaveSyncState {
  /** El save cambio en el disco y hay cambios sin guardar en PESHeX: decide el usuario (dialogo). */
  conflict: boolean;
  reloading: boolean;
  init: () => Promise<void>;
  /** Rust avisa de que otro programa reescribio `path`. */
  onExternalChange: (path: string) => Promise<void>;
  /** Recarga el save abierto del disco (reintenta si el archivo esta a medio escribir). */
  reload: () => Promise<boolean>;
  keepMine: () => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let started = false;
/** Llego otro aviso mientras se recargaba: al terminar se vuelve a recargar. */
let again = false;

export const useSaveSync = create<SaveSyncState>((set, get) => ({
  conflict: false,
  reloading: false,

  async init() {
    if (started) return;
    started = true;
    // Un aviso pendiente no pasa de un archivo a otro.
    useSession.subscribe((s, prev) => {
      if (s.filePath !== prev.filePath) set({ conflict: false });
    });
    await onSaveChanged((e) => void get().onExternalChange(e.path));
  },

  async onExternalChange(path) {
    const s = useSession.getState();
    if (!s.filePath || path !== s.filePath || !useSettings.getState().autoReload) return;
    // Con cambios sin guardar (o guardando) no se pisa nada en silencio: pregunta.
    if (s.pendingCount > 0 || s.saving) return set({ conflict: true });
    await get().reload();
  },

  async reload() {
    if (get().reloading) {
      again = true;
      return false;
    }
    set({ reloading: true, conflict: false });
    let ok = false;
    let lastError: unknown = null;
    try {
      for (let i = 0; i < ATTEMPTS && !ok; i++) {
        if (i > 0) await sleep(RETRY_MS);
        if (!useSession.getState().filePath) break;
        try {
          await useSession.getState().reloadFromDisk();
          ok = true;
        } catch (e) {
          lastError = e;
        }
      }
    } finally {
      set({ reloading: false });
    }
    if (ok) {
      useToasts.getState().push({ kind: "info", text: i18n.t("saveSync.reloaded") });
    } else if (lastError) {
      useToasts.getState().push({
        kind: "warning",
        text: i18n.t("saveSync.failed"),
        detail: errorText(i18n.t.bind(i18n), toApiError(lastError)),
      });
    }
    if (again) {
      again = false;
      return get().reload();
    }
    return ok;
  },

  keepMine: () => set({ conflict: false }),
}));

/** Solo para las pruebas. */
export function resetSaveSyncForTests() {
  started = false;
  again = false;
  useSaveSync.setState({ conflict: false, reloading: false });
}
