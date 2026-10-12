import { create } from "zustand";
import { semantic } from "../api/semantic";
import type { ApplyResult, EditOp, Issue } from "../api/types";
import { toastError, useSession } from "./session";

interface EditState {
  busy: boolean;
  confirm: { ops: EditOp[]; issues: Issue[] } | null;
  /** Aplica operaciones. Si el driver detecta valores fuera de lo habitual,
   *  abre el dialogo de confirmacion y resuelve con `null`. */
  apply: (ops: EditOp[], opts?: { confirmed?: boolean }) => Promise<ApplyResult | null>;
  confirmApply: () => Promise<void>;
  dismiss: () => void;
}

export const useEdit = create<EditState>((set, get) => ({
  busy: false,
  confirm: null,

  async apply(ops, opts = {}) {
    set({ busy: true });
    try {
      const r = await semantic.applyOps(ops, { confirmed: opts.confirmed });
      if (r.needsConfirmation) {
        set({ confirm: { ops, issues: r.needsConfirmation.issues } });
        return null;
      }
      if (r.applied && typeof r.pendingCount === "number") {
        useSession.getState().setCounts(r.pendingCount, 0);
      }
      return r;
    } catch (e) {
      toastError(e);
      return null;
    } finally {
      set({ busy: false });
    }
  },

  async confirmApply() {
    const c = get().confirm;
    if (!c) return;
    set({ confirm: null });
    await get().apply(c.ops, { confirmed: true });
  },

  dismiss: () => set({ confirm: null }),
}));
