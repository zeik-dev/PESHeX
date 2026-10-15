import { Minus, Plus, RotateCcw } from "lucide-react";
import { useId } from "react";
import { clampZoom, stepZoom, useAppliedZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from "../../lib/zoom";
import { useT } from "../../lib/useT";
import { useSettings } from "../../stores/settings";
import { Button, Card, Switch } from "../../ui";
import styles from "./settings.module.css";

/** Zoom de la aplicacion: automático (por defecto: se ajusta a la ventana) o manual de 50 a 200 %. Se aplica al instante. */
export function ZoomCard() {
  const { t } = useT();
  const manual = clampZoom(useSettings((s) => s.zoom));
  const mode = useSettings((s) => s.zoomMode);
  const setZoom = useSettings((s) => s.setZoom);
  const setMode = useSettings((s) => s.setZoomMode);
  const applied = useAppliedZoom();
  const auto = mode === "auto";
  // En automático se muestra la escala que se está aplicando ahora; en manual, la elegida.
  const zoom = auto ? applied : manual;
  const sliderId = useId();

  return (
    <Card title={t("settings.zoom.title")}>
      <div className={styles.zoom}>
        <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
          <Switch
            checked={auto}
            label={t("settings.zoom.auto")}
            onChange={(v) => {
              // Al pasar a manual se parte de la escala que se veía (sin saltos).
              if (!v) setZoom(applied);
              setMode(v ? "auto" : "manual");
            }}
          />
          <span>{t("settings.zoom.auto")}</span>
        </label>
        <p className="muted" style={{ margin: 0 }}>{auto ? t("settings.zoom.autoHelp") : t("settings.zoom.help")}</p>
        <div className={styles.zoomRow}>
          <Button icon aria-label={t("settings.zoom.decrease")} title={t("settings.zoom.decrease")} disabled={auto || zoom <= ZOOM_MIN}
            onClick={() => setZoom(stepZoom(zoom, -1))}>
            <Minus size={16} />
          </Button>
          <label htmlFor={sliderId} className={styles.srOnly}>{t("settings.zoom.slider")}</label>
          <input
            id={sliderId}
            className={styles.zoomSlider}
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={5}
            value={zoom}
            disabled={auto}
            aria-valuetext={t("settings.zoom.value", { percent: zoom })}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <Button icon aria-label={t("settings.zoom.increase")} title={t("settings.zoom.increase")} disabled={auto || zoom >= ZOOM_MAX}
            onClick={() => setZoom(stepZoom(zoom, 1))}>
            <Plus size={16} />
          </Button>
          <output className={styles.zoomValue} data-testid="zoom-value" aria-live="polite">{t("settings.zoom.value", { percent: zoom })}</output>
          <Button disabled={auto || zoom === ZOOM_DEFAULT} onClick={() => setZoom(ZOOM_DEFAULT)}>
            <RotateCcw size={14} /> {t("settings.zoom.reset", { percent: ZOOM_DEFAULT })}
          </Button>
        </div>
      </div>
    </Card>
  );
}
