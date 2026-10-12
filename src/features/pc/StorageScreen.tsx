import { Monitor, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { semantic } from "../../api/semantic";
import { displayName } from "../../lib/pokemon";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { usePc } from "../../stores/pc";
import { useSession } from "../../stores/session";
import { Banner, Button, ConfirmDialog, EmptyState, PageTitle, PokeballSpinner, PokemonIcon } from "../../ui";
import { useSemanticQuery } from "../queries";
import { BoxPanel } from "./BoxPanel";
import { InfoPanel } from "./InfoPanel";
import { PartyTray } from "./PartyTray";
import { useBoxDnd } from "./useBoxDnd";
import { usePcScale } from "./usePcScale";
import styles from "./pc.module.css";

/** PC (caja + equipo + datos) y Equipo (rejilla grande + datos): la misma pantalla con dos disposiciones. */
export function StorageScreen({ mode }: { mode: "pc" | "party" }) {
  const { t } = useT();
  const root = useRef<HTMLDivElement>(null);
  const scale = usePcScale(root);
  const apply = useEdit((s) => s.apply);
  const openEditor = useSession((s) => s.openEditor);
  const profile = useSession((s) => s.profile);
  const linked = useGame((s) => s.status.linked);
  const { box, selected, setBox, select } = usePc();
  const [announce, setAnnounce] = useState("");
  const [releasing, setReleasing] = useState<string | null>(null);

  const storageQ = useSemanticQuery("storage", semantic.storage);
  const partyQ = useSemanticQuery("party", semantic.party);
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

  if (storageQ.isPending || partyQ.isPending) return <PokeballSpinner />;
  if (mode === "pc" && !storage) return <EmptyState>{t("boxes.noStorage")}</EmptyState>;

  const flags: Record<string, "illegal" | "warning"> = {};
  const emptySelected = !!selected && !selectedPk && /^(party|box)\//.test(selected);
  const infoRef = selectedPk ? selectedPk.ref : null;
  const releaseTarget = releasing ? all.get(releasing) : null;

  const ghostPk = dnd.drag ? all.get(dnd.drag.ref) : null;

  return (
    <div ref={root} className={styles.screen}>
      <PageTitle
        icon={mode === "pc" ? <Monitor /> : <Users />}
        title={mode === "pc" ? t("boxes.title") : t("party.title")}
        subtitle={mode === "pc" && storage ? t("boxes.total", { count: storage.total }) : undefined}
      />
      {!linked && (
        <Banner tone="info" title={t("game.bannerTitle")} action={<Button size="sm" onClick={() => useSession.getState().setView("settings")}>{t("game.bannerAction")}</Button>}>
          {t("game.banner")}
        </Banner>
      )}
      {dnd.grab && <div role="status" className={styles.grabHint}>{t("pc.grabHint")}</div>}
      <div className={styles.layout} data-mode={mode}>
        <PartyTray
          party={party}
          limit={limit}
          variant={mode === "pc" ? "tray" : "grid"}
          cell={mode === "pc" ? 72 : 0}
          selected={selected}
          over={dnd.drag?.over ?? null}
          grabRef={dnd.grab ?? dnd.drag?.ref ?? null}
          flags={flags}
          onSelect={select}
          onOpen={openEditor}
          dragProps={dnd.dragProps}
          onCellKey={onCellKey}
          wasDragged={dnd.wasDragged}
        />
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
            onBox={setBox}
            onRename={(name) => void apply([{ op: "box.patch", index: boxIndex, name }])}
            onSelect={select}
            onOpen={openEditor}
            dragProps={dnd.dragProps}
            onCellKey={onCellKey}
            wasDragged={dnd.wasDragged}
          />
        )}
        <InfoPanel pokemonRef={infoRef} emptySlot={emptySelected} editable={editable} onEdit={openEditor} onRelease={setReleasing} />
      </div>

      {dnd.drag && ghostPk && (
        <div ref={dnd.ghostRef} className={styles.ghost} aria-hidden="true">
          <PokemonIcon name={displayName(ghostPk)} species={ghostPk.species?.id ?? 0} form={ghostPk.form} gender={ghostPk.gender}
            shiny={ghostPk.shiny} egg={ghostPk.egg} size={64} />
        </div>
      )}
      <div className={styles.srOnly} role="status" aria-live="polite">{announce}</div>

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
