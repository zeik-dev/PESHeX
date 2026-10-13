import { Copy, Download, HeartPulse, Monitor, Pencil, Plus, Trash2, Upload, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { semantic } from "../../api/semantic";
import type { PokemonSummary } from "../../api/types";
import { displayName } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { usePc } from "../../stores/pc";
import { useHexMode } from "../../stores/settings";
import { useSession } from "../../stores/session";
import { useUi } from "../../stores/ui";
import { Banner, Button, ConfirmDialog, ContextMenu, EmptyState, PageTitle, PokeballSpinner, PokemonIcon, Switch, type MenuItem } from "../../ui";
import { useLegality } from "../legality/useLegality";
import { healOps } from "../pokemon/quick";
import { useClonePokemon } from "../pokemon/actions";
import { useSemanticQuery } from "../queries";
import { AddPokemonDialog } from "./AddPokemonDialog";
import { BoxPanel } from "./BoxPanel";
import { InfoPanel } from "./InfoPanel";
import { PartyTray } from "./PartyTray";
import { useBoxDnd } from "./useBoxDnd";
import { usePcScale } from "./usePcScale";
import styles from "./pc.module.css";

/** PC (caja + equipo + datos) y Equipo (rejilla grande + datos): la misma pantalla con dos disposiciones. */
export function StorageScreen({ mode }: { mode: "pc" | "party" }) {
  const { t } = useT();
  // La escala de la caja se mide sobre el area de la rejilla (no sobre la pantalla entera: el aviso de arriba resta alto).
  const { scale, ref: layoutRef } = usePcScale();
  const apply = useEdit((s) => s.apply);
  const openEditor = useSession((s) => s.openEditor);
  const profile = useSession((s) => s.profile);
  const linked = useGame((s) => s.status.linked);
  const { box, selected, setBox, select, onlyIllegal, setOnlyIllegal } = usePc();
  const [announce, setAnnounce] = useState("");
  const [releasing, setReleasing] = useState<string | null>(null);
  // Clic derecho: casilla y posicion del menu; `adding` = casilla vacia donde se esta agregando un Pokémon.
  const [menu, setMenu] = useState<{ x: number; y: number; dropRef: string; pk: PokemonSummary | null } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const clone = useClonePokemon();

  const storageQ = useSemanticQuery("storage", semantic.storage);
  const partyQ = useSemanticQuery("party", semantic.party);
  // La legalidad solo existe en HeX: en HaX ni se consulta ni se muestra nada de ella.
  const hex = useHexMode();
  const legalityQ = useLegality(hex);
  const report = hex ? legalityQ.data : undefined;
  const storage = storageQ.data;
  const party = useMemo(() => partyQ.data ?? [], [partyQ.data]);
  const editable = profile?.editable ?? false;
  const limit = storage ? 6 : 6;

  const dnd = useBoxDnd({
    onDrop: (from, to) => void move(from, to),
    onNav: (dir) => {
      const cur = usePc.getState().box ?? storage?.currentBox ?? 0;
      const next = Math.min(Math.max(cur + (dir === "next" ? 1 : -1), 0), (storage?.boxes.length ?? 1) - 1);
      setBox(next);
    },
  });

  const boxIndex = storage ? Math.min(Math.max(box ?? storage.currentBox ?? 0, 0), storage.boxes.length - 1) : 0;

  // Lo seleccionado puede ser un Pokemon (su ref) o una casilla vacia (ref de destino).
  const all = useMemo(() => {
    const m = new Map<string, (typeof party)[number]>();
    party.forEach((p) => m.set(p.ref, p));
    storage?.boxes.forEach((b) => b.slots.forEach((p) => p && m.set(p.ref, p)));
    return m;
  }, [party, storage]);
  const selectedPk = selected ? all.get(selected) ?? null : null;

  useEffect(() => {
    // Si el seleccionado ya no existe (p. ej. tras deshacer), se limpia.
    if (selected && !selectedPk && !/^(party|box)\//.test(selected)) select(null);
  }, [selected, selectedPk, select]);

  async function move(from: string, to: string) {
    const fromPk = all.get(from);
    const r = await apply([{ op: "pokemon.move", from, to }]);
    if (r?.applied) {
      select(to);
      setAnnounce(t("pc.moved", { name: fromPk ? displayName(fromPk) : from, to: describeRef(to) }));
    }
  }

  function describeRef(ref: string): string {
    const [kind, a, b] = ref.split("/");
    if (kind === "party") return t("party.title");
    const bx = storage?.boxes[Number(a)];
    return `${bx?.name || t("boxes.box", { n: Number(a) + 1 })} · ${Number(b) + 1}`;
  }

  function onCellKey(e: React.KeyboardEvent, occupant: string | null, dropRef: string): boolean {
    const wasGrab = dnd.grab;
    const handled = dnd.onCellKey(e, occupant, dropRef);
    if (handled && e.key === " ") {
      if (wasGrab == null && occupant) {
        const pk = all.get(occupant);
        setAnnounce(t("pc.grabbed", { name: pk ? displayName(pk) : occupant }));
      }
    }
    return handled;
  }

  async function release(ref: string) {
    setReleasing(null);
    const r = await apply([{ op: "pokemon.remove", ref }]);
    if (r?.applied) select(null);
  }

  function onContextMenu(e: React.MouseEvent, pk: PokemonSummary | null, dropRef: string) {
    e.preventDefault();
    select(dropRef);
    setMenu({ x: e.clientX, y: e.clientY, dropRef, pk });
  }

  const menuItems: MenuItem[] = menu?.pk
    ? [
        { id: "edit", label: t("pc.menu.edit"), icon: <Pencil size={14} />, onSelect: () => openEditor(menu.pk!.ref) },
        { id: "clone", label: t("pc.menu.clone"), icon: <Copy size={14} />, disabled: !editable, onSelect: () => void clone(menu.pk!.ref) },
        { id: "export", label: t("pc.menu.export"), icon: <Download size={14} />, onSelect: () => useUi.getState().setExportRef(menu.pk!.ref) },
        { id: "delete", label: t("pc.menu.delete"), icon: <Trash2 size={14} />, danger: true, disabled: !editable, onSelect: () => setReleasing(menu.pk!.ref) },
      ]
    : menu
      ? [{ id: "add", label: t("pc.menu.add"), icon: <Plus size={14} />, disabled: !editable, onSelect: () => setAdding(menu.dropRef) }]
      : [];

  if (storageQ.isPending || partyQ.isPending) return <PokeballSpinner />;
  if (mode === "pc" && !storage) return <EmptyState>{t("boxes.noStorage")}</EmptyState>;

  const flags: Record<string, "illegal" | "warning"> = {};
  const illegalPerBox: Record<number, number> = {};
  for (const [ref, list] of Object.entries(report?.flags ?? {})) {
    const worst = list.some((f) => f.severity === "illegal") ? "illegal" : list.some((f) => f.severity === "warning") ? "warning" : null;
    if (!worst) continue;
    flags[ref] = worst;
    if (worst === "illegal" && ref.startsWith("box/")) {
      const b = Number(ref.split("/")[1]);
      illegalPerBox[b] = (illegalPerBox[b] ?? 0) + 1;
    }
  }
  const isDim = (ref: string | null) => hex && onlyIllegal && (ref == null || flags[ref] !== "illegal");
  const emptySelected = !!selected && !selectedPk && /^(party|box)\//.test(selected);
  const infoRef = selectedPk ? selectedPk.ref : null;
  const releaseTarget = releasing ? all.get(releasing) : null;

  const ghostPk = dnd.drag ? all.get(dnd.drag.ref) : null;

  return (
    <div className={styles.screen}>
      <PageTitle icon={mode === "pc" ? <Monitor /> : <Users />} title={mode === "pc" ? t("boxes.title") : t("party.title")} />
      {!linked && (
        <Banner tone="info" title={t("game.bannerTitle")} action={<Button size="sm" onClick={() => useSession.getState().setView("settings")}>{t("game.bannerAction")}</Button>}>
          {t("game.banner")}
        </Banner>
      )}
      {dnd.grab && <div role="status" className={styles.grabHint}>{t("pc.grabHint")}</div>}
      <div ref={layoutRef} className={styles.layout} data-mode={mode}>
        <div className={styles.side} data-mode={mode}>
          <PartyTray
            party={party}
            limit={limit}
            variant={mode === "pc" ? "tray" : "grid"}
            cell={mode === "pc" ? 72 : 0}
            selected={selected}
            over={dnd.drag?.over ?? null}
            grabRef={dnd.grab ?? dnd.drag?.ref ?? null}
            flags={flags}
            isDim={isDim}
            onSelect={select}
            onOpen={openEditor}
            dragProps={dnd.dragProps}
            onCellKey={onCellKey}
            wasDragged={dnd.wasDragged}
            onContextMenu={onContextMenu}
          />
          <div className={styles.sideTools}>
            {mode === "pc" && storage && <div className="muted" data-testid="pc-total">{t("boxes.total", { count: storage.total })}</div>}
            {hex && (
              <div className={styles.sideRow}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }} title={t("legality.onlyIllegalHint")}>
                  <Switch checked={onlyIllegal} onChange={setOnlyIllegal} label={t("legality.onlyIllegal")} />
                  {t("legality.onlyIllegal")}
                </label>
                {report && report.summary.illegal > 0 && <span className="muted">{t("legality.illegal", { count: report.summary.illegal })}</span>}
              </div>
            )}
            <div className={styles.sideRow}>
              <Button size="sm" disabled={!editable || party.length === 0} onClick={() => void apply(healOps(party.map((p) => p.ref)))}>
                <HeartPulse size={14} /> {t("quick.healParty")}
              </Button>
              <Button size="sm" disabled={!editable} onClick={() => useUi.getState().setImportOpen(true)}>
                <Upload size={14} /> {t("transfer.import")}
              </Button>
            </div>
          </div>
        </div>
        {mode === "pc" && storage && (
          <BoxPanel
            box={storage.boxes[boxIndex]}
            index={boxIndex}
            boxCount={storage.boxes.length}
            currentBox={storage.currentBox}
            boxes={storage.boxes}
            scale={scale}
            selected={selected}
            over={dnd.drag?.over ?? null}
            grabRef={dnd.grab ?? dnd.drag?.ref ?? null}
            editable={editable}
            flags={flags}
            isDim={isDim}
            illegalPerBox={illegalPerBox}
            onBox={setBox}
            onRename={(name) => void apply([{ op: "box.patch", index: boxIndex, name }])}
            onSelect={select}
            onOpen={openEditor}
            dragProps={dnd.dragProps}
            onCellKey={onCellKey}
            wasDragged={dnd.wasDragged}
            onContextMenu={onContextMenu}
          />
        )}
        <InfoPanel pokemonRef={infoRef} emptySlot={emptySelected} emptyRef={emptySelected ? selected : null} editable={editable} partial={report?.coverage.level !== "full"} onEdit={openEditor} onRelease={setReleasing} onAdd={setAdding} />
      </div>

      {dnd.drag && ghostPk && (
        <div ref={dnd.ghostRef} className={styles.ghost} aria-hidden="true">
          <PokemonIcon name={displayName(ghostPk)} species={ghostPk.species?.id ?? 0} form={ghostPk.form} gender={ghostPk.gender}
            shiny={ghostPk.shiny} egg={ghostPk.egg} size={64} />
        </div>
      )}
      <div className={styles.srOnly} role="status" aria-live="polite">{announce}</div>

      <ContextMenu open={!!menu} point={menu ? { x: menu.x, y: menu.y } : null} items={menuItems} label={t("pc.menuLabel")} onClose={() => setMenu(null)} />
      <AddPokemonDialog target={adding} onClose={() => setAdding(null)} describe={describeRef} onAdded={select} />

      <ConfirmDialog
        open={!!releaseTarget}
        danger
        title={t("pc.releaseTitle", { name: releaseTarget ? displayName(releaseTarget) : "" })}
        confirmLabel={t("pc.release")}
        onConfirm={() => releasing && void release(releasing)}
        onCancel={() => setReleasing(null)}
      >
        <p>{t("pc.releaseBody")}</p>
      </ConfirmDialog>
    </div>
  );
}
