import { create } from "zustand";
import i18n from "../i18n";
import { onRevision, openSave, closeSave, reloadSave, toApiError } from "../api/tauri";
import { gameApi } from "../api/game";
import { semantic } from "../api/semantic";
import type { ApiError, Mode, OpenResult, Profile, RoundtripResult } from "../api/types";
import { errorText } from "../lib/errors";
import { fileName } from "../lib/format";
import { useEdit } from "./edit";
import { useGame } from "./game";
import { usePc } from "./pc";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";
import { useUi } from "./ui";

export type ViewId =
  | "overview" | "trainer" | "party" | "boxes" | "bag" | "pokedex" | "world" | "unclassified" | "changes" | "backups"
  | "advanced" | "settings";

export interface SaveConfirm {
  reason: "roundtrip_diff";
}

interface SessionState {
  filePath: string | null;
  openInfo: OpenResult | null;
  profile: Profile | null;
  opening: boolean;
  openError: ApiError | null;
  roundtrip: RoundtripResult | null;
  revision: number;
  /** Cuantas veces se ha recargado el save desde el disco desde que se abrio (para invalidar lo que no depende de `revision`). */
  reloads: number;
  pendingCount: number;
  redoCount: number;
  saving: boolean;
  saveConfirm: SaveConfirm | null;
  closeConfirm: boolean;

  view: ViewId;
  advancedFilter: string;
  editorRef: string | null;

  open: (path: string) => Promise<void>;
  /** Vuelve a leer del disco el save abierto (otro programa lo reescribio). Rechaza si no se pudo: la sesion queda como estaba. */
  reloadFromDisk: () => Promise<void>;
  close: (force?: boolean) => Promise<void>;
  dismissCloseConfirm: () => void;
  setView: (v: ViewId) => void;
  /** Cambia HeX/HaX: se recuerda en ajustes y se avisa al driver si hay un archivo abierto. */
  changeMode: (mode: Mode) => Promise<void>;
  /** Pide un modo: HaX se aplica directamente; HeX pasa antes por el aviso (puede fallar en algunos fangames). */
  requestMode: (mode: Mode) => void;
  setProfile: (p: Profile) => void;
  noteRevision: (n: number) => void;
  setCounts: (pending: number, redo?: number) => void;
  openEditor: (ref: string) => void;
  closeEditor: () => void;
  locateInAdvanced: (path: string) => void;

  undo: () => Promise<void>;
  redo: () => Promise<void>;
  undoAll: () => Promise<void>;
  save: (confirmed?: boolean) => Promise<void>;
  dismissSaveConfirm: () => void;
}

const initial = {
  filePath: null,
  openInfo: null,
  profile: null,
  opening: false,
  openError: null,
  roundtrip: null,
  revision: 0,
  reloads: 0,
  pendingCount: 0,
  redoCount: 0,
  saving: false,
  saveConfirm: null,
  closeConfirm: false,
  view: "overview" as ViewId,
  advancedFilter: "",
  editorRef: null,
};

export const useSession = create<SessionState>((set, get) => ({
  ...initial,

  async open(path) {
    set({ opening: true, openError: null });
    try {
      const info = await openSave(path);
      set({
        ...initial,
        filePath: path,
        openInfo: info,
        profile: info.profile,
        revision: info.revision ?? 0,
        view: "overview",
      });
      useSettings.getState().pushRecent(path);
      useUi.getState().closeHomeSettings();
      // El modo (HeX/HaX) se recuerda entre sesiones: el driver arranca en HaX.
      if (useSettings.getState().mode !== (info.mode ?? "hax")) void semantic.setMode(useSettings.getState().mode).catch(() => undefined);
      // Carpeta del juego (nombres + sprites): en segundo plano, no bloquea el primer render.
      useGame.getState().reset();
      void useGame.getState().onSaveOpened(path, info.gameSuggestion);
      // La verificacion del roundtrip cuesta ~1 s en saves grandes: va en segundo plano.
      void semantic
        .verifyRoundtrip()
        .then((r) => {
          if (get().filePath === path) set({ roundtrip: r });
        })
        .catch(() => undefined);
    } catch (e) {
      set({ opening: false, openError: toApiError(e) });
      return;
    }
    set({ opening: false });
  },

  async reloadFromDisk() {
    const path = get().filePath;
    if (!path) return;
    const info = await reloadSave();
    if (get().filePath !== path) return; // se cerro o se abrio otro mientras tanto
    // A diferencia de `open`: la vista, la carpeta del juego y el modo se quedan; lo que dependia del documento viejo no.
    set({
      openInfo: info,
      profile: info.profile,
      revision: Math.max(info.revision ?? 0, get().revision),
      reloads: get().reloads + 1,
      pendingCount: 0,
      redoCount: 0,
      saveConfirm: null,
      closeConfirm: false,
      roundtrip: null,
      editorRef: null,
    });
    usePc.getState().reset();
    void semantic
      .verifyRoundtrip()
      .then((r) => {
        if (get().filePath === path) set({ roundtrip: r });
      })
      .catch(() => undefined);
  },

  async close(force = false) {
    if (!force && get().pendingCount > 0) {
      set({ closeConfirm: true });
      return;
    }
    try {
      await closeSave();
    } finally {
      useGame.getState().reset();
      void gameApi.forget().catch(() => undefined);
      set({ ...initial });
    }
  },

  dismissCloseConfirm: () => set({ closeConfirm: false }),
  setView: (view) => set({ view }),
  async changeMode(mode) {
    useSettings.getState().setMode(mode);
    if (!get().filePath) return;
    try {
      await semantic.setMode(mode);
    } catch (e) {
      toastError(e);
    }
  },
  requestMode(mode) {
    if (mode === useSettings.getState().mode) return;
    if (mode === "hex") useUi.getState().setHexConfirm(true);
    else void get().changeMode(mode);
  },
  setProfile: (profile) => set({ profile }),
  noteRevision: (n) => set((s) => (n > s.revision ? { revision: n } : s)),
  setCounts: (pendingCount, redoCount) =>
    set((s) => ({ pendingCount, redoCount: redoCount ?? s.redoCount })),
  openEditor: (ref) => set({ editorRef: ref }),
  closeEditor: () => set({ editorRef: null }),
  locateInAdvanced: (path) => set({ advancedFilter: path, view: "advanced" }),

  async undo() {
    try {
      const r = await semantic.undo();
      if (r.applied) get().setCounts(r.pendingCount ?? 0, r.redoCount);
    } catch (e) {
      toastError(e);
    }
  },
  async redo() {
    try {
      const r = await semantic.redo();
      if (r.applied) get().setCounts(r.pendingCount ?? 0, r.redoCount);
    } catch (e) {
      toastError(e);
    }
  },
  async undoAll() {
    try {
      const r = await semantic.undoAll();
      get().setCounts(r.pendingCount, r.redoCount);
    } catch (e) {
      toastError(e);
    }
  },

  async save(confirmed = false) {
    if (get().saving) return;
    set({ saving: true });
    try {
      const r = await semantic.save({ backup: useSettings.getState().backup, confirmed });
      if (r.rejected) {
        useEdit.getState().reject(r.rejected.flags, "save");
      } else if (r.needsConfirmation) {
        set({ saveConfirm: { reason: "roundtrip_diff" } });
      } else if (r.applied) {
        set({ pendingCount: 0, redoCount: 0, saveConfirm: null });
        useToasts.getState().push({
          kind: "success",
          text: i18n.t("save.done"),
          detail: r.backupPath ? i18n.t("save.backup", { path: r.backupPath }) : undefined,
        });
      }
    } catch (e) {
      toastError(e);
    } finally {
      set({ saving: false });
    }
  },
  dismissSaveConfirm: () => set({ saveConfirm: null }),
}));

onRevision((n) => useSession.getState().noteRevision(n));

export function toastError(e: unknown) {
  const err = toApiError(e);
  useToasts.getState().push({ kind: "error", text: errorText(i18n.t.bind(i18n), err) });
}

export function currentFileName(): string {
  const p = useSession.getState().filePath;
  return p ? fileName(p) : "";
}
