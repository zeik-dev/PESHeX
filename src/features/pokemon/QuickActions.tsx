import { Calculator, Copy, Download, HeartPulse, Sparkles } from "lucide-react";
import type { PokemonDetail } from "../../api/types";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { useToasts } from "../../stores/toasts";
import { useUi } from "../../stores/ui";
import { Button, SelectField } from "../../ui";
import { EV_PRESETS, evPresetOps, healOps, perfectIvOps, type EvPreset } from "./quick";
import styles from "./pokemon.module.css";

/** El recalculo exige carpeta del juego y estadisticas calibradas (si no, el driver lo rechaza con RecalcUnavailable). */
export function useRecalcAvailable(): boolean {
  return useGame((s) => s.status.linked && s.status.calibration?.stats?.status === "ok");
}

export function QuickActions({ pk, editable }: { pk: PokemonDetail; editable: boolean }) {
  const { t, dyn } = useT();
  const apply = useEdit((s) => s.apply);
  const busy = useEdit((s) => s.busy);
  const recalc = useRecalcAvailable();
  const setExportRef = useUi((s) => s.setExportRef);
  const off = !editable || busy;

  async function clone() {
    const r = await apply([{ op: "pokemon.clone", ref: pk.ref, to: "auto" }]);
    if (r?.applied) useToasts.getState().push({ kind: "success", text: t("quick.cloned") });
  }

  return (
    <section className={styles.quick} aria-label={t("quick.title")}>
      <div className={styles.quickRow}>
        <Button size="sm" disabled={off} onClick={() => void apply(healOps([pk.ref]))}>
          <HeartPulse size={14} /> {t("quick.heal")}
        </Button>
        <Button size="sm" disabled={off} onClick={() => void apply(perfectIvOps(pk))}>
          <Sparkles size={14} /> {t("quick.perfectIv")}
        </Button>
        <Button size="sm" disabled={off || !recalc} title={recalc ? t("quick.recalcHint") : t("quick.recalcUnavailable")}
          onClick={() => void apply([{ op: "pokemon.recalc", ref: pk.ref }])}>
          <Calculator size={14} /> {t("quick.recalc")}
        </Button>
        <Button size="sm" disabled={off} onClick={() => void clone()}>
          <Copy size={14} /> {t("quick.clone")}
        </Button>
        <Button size="sm" onClick={() => setExportRef(pk.ref)}>
          <Download size={14} /> {t("quick.export")}
        </Button>
      </div>
      <div className={styles.quickRow}>
        <label className="muted" htmlFor={`ev-preset-${pk.ref}`} style={{ fontSize: 12 }}>{t("quick.evPreset")}</label>
        <SelectField<string>
          id={`ev-preset-${pk.ref}`}
          value=""
          disabled={off}
          options={[{ value: "", label: t("quick.evChoose") }, ...EV_PRESETS.map((p) => ({ value: p as string, label: dyn(`quick.ev.${p}`) }))]}
          onChange={(v) => v && void apply(evPresetOps(pk, v as EvPreset))}
        />
      </div>
    </section>
  );
}
