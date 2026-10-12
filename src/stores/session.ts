import { create } from "zustand";
import i18n from "../i18n";
import { onRevision, openSave, closeSave, toApiError } from "../api/tauri";
import { semantic } from "../api/semantic";
import type { ApiError, Issue, OpenResult, Profile, RoundtripResult } from "../api/types";
import { errorText } from "../lib/errors";
import { fileName } from "../lib/format";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";

export type ViewId =
  | "overview" | "trainer" | "party" | "boxes" | "bag" | "unclassified" | "changes" | "advanced" | "settings";

export interface SaveConfirm {
  reason: "roundtrip_diff" | "validation";
  issues: Issue[];
}

interface SessionState {
  filePath: string | null;
  openInfo: OpenResult | null;
  profile: Profile | null;
  opening: boolean;
  openError: ApiError | null;
  roundtrip: RoundtripResult | null;
  revision: number;
  pendingCount: number;
  redoCount: number;
  saving: boolean;
  saveConfirm: SaveConfirm | null;
  closeConfirm: boolean;

  view: ViewId;
  advancedFilter: string;
  editorRef: string | null;

  open: (path: string) => Promise<void>;
  close: (force?: boolean) => Promise<void>;
  dismissCloseConfirm: () => void;
  setView: (v: ViewId) => void;
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

  async close(force = false) {
    if (!force && get().pendingCount > 0) {
      set({ closeConfirm: true });
      return;
    }
    try {
      await closeSave();
    } finally {
      set({ ...initial });
    }
  },

  dismissCloseConfirm: () => set({ closeConfirm: false }),
  setView: (view) => set({ view }),
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
      if (r.needsConfirmation) {
        set({
          saveConfirm: {
            reason: r.reason === "roundtrip_diff" ? "roundtrip_diff" : "validation",
            issues: r.issues ?? [],
          },
        });
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
