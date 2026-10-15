import { Calculator, ChevronLeft, Download, HeartPulse, Sparkles, Zap } from "lucide-react";
import { useRef, useState } from "react";
import type { PokemonDetail } from "../../api/types";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useGame } from "../../stores/game";
import { useUi } from "../../stores/ui";
import { Button, Popover } from "../../ui";
import { EvPresetControl } from "./EvPresets";
import { healOps, perfectIvOps } from "./quick";
import styles from "./pokemon.module.css";

/** El recalculo exige carpeta del juego y estadisticas calibradas (si no, el driver lo rechaza con RecalcUnavailable). */
export function useRecalcAvailable(): boolean {
  return useGame((s) => s.status.linked && s.status.calibration?.stats?.status === "ok");
}

/** Acciones rápidas de un Pokémon (curar, IV al máximo, recalcular, presets de EV, exportar).
 *  `variant="popover"`: un único botón «Acciones rápidas» que abre un desplegable HACIA LA IZQUIERDA (panel de datos);
 *  `"inline"`: las mismas acciones en línea (hoja de edición); los presets de EV no van aquí: la pestaña IV y EV del editor
 *  trae su propio selector. */
export function QuickActions({
  pk,
  editable,
  variant = "inline",
}: {
  pk: PokemonDetail;
  editable: boolean;
  variant?: "inline" | "popover";
}) {
  const { t } = useT();
  const apply = useEdit((s) => s.apply);
  const busy = useEdit((s) => s.busy);
  const recalc = useRecalcAvailable();
  const setExportRef = useUi((s) => s.setExportRef);
  const off = !editable || busy;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  const actions = (
    <>
      <div className={variant === "popover" ? styles.quickList : styles.quickRow}>
        <Button size="sm" disabled={off} onClick={() => void apply(healOps([pk.ref]))}>
          <HeartPulse size={14} /> {t("quick.heal")}
        </Button>
        <Button size="sm" disabled={off} onClick={() => void apply(perfectIvOps(pk))}>
          <Sparkles size={14} /> {t("quick.perfectIv")}
        </Button>
        <Button
          size="sm"
          disabled={off || !recalc}
          title={recalc ? t("quick.recalcHint") : t("quick.recalcUnavailable")}
          onClick={() => void apply([{ op: "pokemon.recalc", ref: pk.ref }])}
        >
          <Calculator size={14} /> {t("quick.recalc")}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setOpen(false);
            setExportRef(pk.ref);
          }}
        >
          <Download size={14} /> {t("quick.export")}
        </Button>
      </div>
      {variant === "popover" && <EvPresetControl pk={pk} editable={editable} />}
    </>
  );

  if (variant === "inline") {
    return (
      <section className={styles.quick} aria-label={t("quick.title")}>
        {actions}
      </section>
    );
  }

  return (
    <>
      <Button
        ref={trigger}
        size="sm"
        className={styles.quickTrigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Zap size={14} /> {t("quick.title")} <ChevronLeft size={14} aria-hidden="true" />
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={trigger} placement="left" label={t("quick.title")} className={styles.quickPopover}>
        <section className={styles.quick}>{actions}</section>
      </Popover>
    </>
  );
}
