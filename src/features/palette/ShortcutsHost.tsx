import { useEffect } from "react";
import { useSession } from "../../stores/session";
import { useUi } from "../../stores/ui";

/** Campo donde Ctrl+Z/Y deshacen texto del propio navegador, no cambios del save. */
export function isTextEditing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "range", "file"].includes(type);
  }
  return false;
}

export type ShortcutAction = "palette" | "save" | "undo" | "redo";

/** Ctrl/Cmd+K, S, Z, Y (y Mayus+Z). Devuelve la accion o null si no es un atajo nuestro. */
export function shortcutFor(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "key" | "target">): ShortcutAction | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "k") return "palette";
  if (k === "s") return "save";
  const editing = isTextEditing(e.target);
  if (k === "z") return editing ? null : e.shiftKey ? "redo" : "undo";
  if (k === "y") return editing ? null : "redo";
  return null;
}

/** Atajos globales de teclado (solo con un archivo abierto). */
export function ShortcutsHost() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shortcutFor(e);
      if (!action) return;
      const s = useSession.getState();
      if (!s.filePath) return;
      e.preventDefault();
      if (action === "palette") useUi.getState().togglePalette();
      else if (action === "save") {
        if (s.pendingCount > 0) void s.save();
      } else if (action === "undo") {
        if (s.pendingCount > 0) void s.undo();
      } else if (s.redoCount > 0) void s.redo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
