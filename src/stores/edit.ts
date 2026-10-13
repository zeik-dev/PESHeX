import { create } from "zustand";
import i18n from "../i18n";
import { semantic } from "../api/semantic";
import type { ApplyResult, EditOp, Flag } from "../api/types";
import { toastError, useSession } from "./session";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";

interface EditState {
  busy: boolean;
  /** HeX rechazo la edicion: flags que habria introducido (dialogo sin "aplicar igual"). */
  rejected: { flags: Flag[]; where: "edit" | "save" } | null;
  /** Aplica operaciones segun el modo actual. Resuelve con `null` si el driver las rechazo
   *  (HeX) o fallo; en HaX avisa con un toast no modal si introdujeron flags. */
  apply: (ops: EditOp[]) => Promise<ApplyResult | null>;
  reject: (flags: Flag[], where?: "edit" | "save") => void;
  dismiss: () => void;
}

export const useEdit = create<EditState>((set) => ({
  busy: false,
  rejected: null,

  async apply(ops) {
    set({ busy: true });
    try {
      const r = await semantic.applyOps(ops, { mode: useSettings.getState().mode });
      if (r.rejected) {
        set({ rejected: { flags: r.rejected.flags, where: "edit" } });
        return null;
      }
      if (r.applied && typeof r.pendingCount === "number") {
        useSession.getState().setCounts(r.pendingCount, 0);
      }
      const bad = (r.newFlags ?? []).filter((f) => f.severity !== "info");
      if (r.applied && bad.length > 0 && useSettings.getState().mode === "hex") {
        useToasts.getState().push({ kind: "warning", text: i18n.t("mode.haxApplied", { count: bad.length }) });
      }
      return r;
    } catch (e) {
      toastError(e);
      return null;
    } finally {
      set({ busy: false });
    }
  },

  reject: (flags, where = "edit") => set({ rejected: { flags, where } }),
  dismiss: () => set({ rejected: null }),
}));
