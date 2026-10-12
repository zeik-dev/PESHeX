import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info" | "warning";
  text: string;
  detail?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">, ttlMs?: number) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, ttlMs) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    const ttl = ttlMs ?? (t.kind === "error" ? 9000 : 4500);
    if (ttl > 0 && typeof window !== "undefined") window.setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
