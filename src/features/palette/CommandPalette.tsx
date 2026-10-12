import { useEffect, useMemo, useRef, useState } from "react";
import { extras } from "../../api/extras";
import { semantic } from "../../api/semantic";
import type { SearchResult } from "../../api/types";
import { visibleNav } from "../../app/nav";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { usePc } from "../../stores/pc";
import { toastError, useSession } from "../../stores/session";
import { effectiveLang, useSettings } from "../../stores/settings";
import { useUi } from "../../stores/ui";
import { Modal } from "../../ui";
import { healOps } from "../pokemon/quick";
import { filterCommands, hitTarget, HIT_GROUPS, type HitGroup, type PaletteCmd } from "./commands";
import styles from "./palette.module.css";

interface Row {
  key: string;
  group: string;
  label: string;
  sub?: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

/** Ctrl+K: ir a una vista, ejecutar una accion o buscar Pokemon, objetos, cajas y switches/variables del save. */
export function CommandPalette() {
  const { t, dyn } = useT();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<SearchResult | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const profile = useSession((s) => s.profile);
  const pending = useSession((s) => s.pendingCount);
  const redoCount = useSession((s) => s.redoCount);
  const settings = useSettings();

  // Al abrir: consulta vacia y foco en el campo (el Modal enfoca su contenedor despues del montaje).
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setResult(null);
    const h = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(h);
  }, [open]);

  // Busqueda global con retardo; se descartan respuestas viejas.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setResult(null);
      return;
    }
    let live = true;
    const h = setTimeout(() => {
      extras.search(q, 6).then((r) => live && setResult(r), () => live && setResult(null));
    }, 150);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [query, open]);

  const close = () => setOpen(false);

  const cmds: PaletteCmd[] = useMemo(() => {
    const go = (view: Parameters<ReturnType<typeof useSession.getState>["setView"]>[0]) => () => {
      useSession.getState().setView(view);
      close();
    };
    const st = useSession.getState;
    const nav: PaletteCmd[] = visibleNav(profile?.roles ?? {}).map((n) => ({
      id: `view:${n.id}`, group: "view", label: t("palette.goto", { view: dyn(`nav.${n.id}`) }), keywords: dyn(`nav.${n.id}`), run: go(n.id),
    }));
    const act = (id: string, label: string, run: () => void, extra: Partial<PaletteCmd> = {}): PaletteCmd => ({
      id: `action:${id}`, group: "action", label, run: () => { close(); run(); }, ...extra,
    });
    return [
      ...nav,
      act("save", t("palette.save"), () => void st().save(), { shortcut: "Ctrl+S", disabled: pending === 0, keywords: "guardar save" }),
      act("undo", t("common.undo"), () => void st().undo(), { shortcut: "Ctrl+Z", disabled: pending === 0, keywords: "undo deshacer" }),
      act("redo", t("common.redo"), () => void st().redo(), { shortcut: "Ctrl+Y", disabled: redoCount === 0, keywords: "redo rehacer" }),
      act("mode", t("palette.toggleMode", { mode: settings.mode === "hex" ? "HaX" : "HeX" }), () => void st().changeMode(settings.mode === "hex" ? "hax" : "hex"), { keywords: "hex hax modo mode" }),
      act("heal", t("palette.healParty"), () => {
        void semantic.party().then((party) => useEdit.getState().apply(healOps(party.map((p) => p.ref)))).catch(toastError);
      }, { disabled: !(profile?.editable ?? false), keywords: "curar heal equipo party" }),
      act("import", t("palette.importPokemon"), () => useUi.getState().setImportOpen(true), { disabled: !(profile?.editable ?? false), keywords: "importar showdown json" }),
      act("theme", t("palette.toggleTheme"), () => settings.setTheme(settings.theme === "dark" ? "light" : "dark"), { keywords: "tema theme oscuro claro dark light" }),
      act("lang", t("palette.toggleLang"), () => settings.setLang(effectiveLang(settings.lang) === "es" ? "en" : "es"), { keywords: "idioma language espanol english" }),
      act("close", t("header.closeFile"), () => void st().close(), { keywords: "cerrar close" }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, pending, redoCount, settings.mode, settings.theme, settings.lang, t, dyn]);

  const rows: Row[] = useMemo(() => {
    const list: Row[] = filterCommands(cmds, query).map((c) => ({
      key: c.id, group: c.group === "view" ? t("palette.groupViews") : t("palette.groupActions"), label: c.label, shortcut: c.shortcut, disabled: c.disabled, run: c.run,
    }));
    if (result) {
      for (const g of HIT_GROUPS) {
        for (const hit of result.groups[g as HitGroup] ?? []) {
          const target = hitTarget(g, hit);
          if (!target) continue;
          list.push({
            key: `${g}:${hit.ref ?? hit.index ?? hit.id}:${hit.label}`,
            group: dyn(`palette.groups.${g}`), label: hit.label, sub: hit.sub,
            run: () => {
              close();
              if (target.world) useUi.getState().setWorldTarget(target.world);
              if (target.box != null) usePc.getState().setBox(target.box);
              if (target.select) usePc.getState().select(target.select);
              useSession.getState().setView(target.view);
            },
          });
        }
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmds, query, result, t, dyn]);

  useEffect(() => setActive((a) => Math.min(a, Math.max(rows.length - 1, 0))), [rows.length]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row && !row.disabled) row.run();
    }
  }

  useEffect(() => {
    document.getElementById(`palette-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  let lastGroup = "";
  return (
    <Modal open={open} title={t("palette.title")} onClose={close}>
      <input
        ref={input}
        className={styles.input}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={rows.length ? `palette-opt-${active}` : undefined}
        aria-label={t("palette.placeholder")}
        placeholder={t("palette.placeholder")}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActive(0); }}
        onKeyDown={onKey}
      />
      <ul id="palette-list" role="listbox" className={styles.list} aria-label={t("palette.title")}>
        {rows.length === 0 && <li className={styles.empty}>{t("palette.noResults")}</li>}
        {rows.map((r, i) => {
          const header = r.group !== lastGroup ? r.group : null;
          lastGroup = r.group;
          return (
            <li key={r.key} role="presentation">
              {header && <div className={styles.group}>{header}</div>}
              <div
                id={`palette-opt-${i}`}
                role="option"
                aria-selected={i === active}
                aria-disabled={r.disabled || undefined}
                className={styles.option}
                data-active={i === active}
                data-disabled={r.disabled || undefined}
                onMouseMove={() => setActive(i)}
                onClick={() => !r.disabled && r.run()}
              >
                <span className={styles.label}>{r.label}</span>
                {r.sub && <span className="muted" style={{ fontSize: 12 }}>{r.sub}</span>}
                {r.shortcut && <kbd className={styles.kbd}>{r.shortcut}</kbd>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>{t("palette.hint")}</p>
    </Modal>
  );
}
