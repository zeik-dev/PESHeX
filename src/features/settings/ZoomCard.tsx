import { Minus, Plus, RotateCcw } from "lucide-react";
import { useId } from "react";
import { clampZoom, stepZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from "../../lib/zoom";
import { useT } from "../../lib/useT";
import { useSettings } from "../../stores/settings";
import { Button, Card } from "../../ui";
import styles from "./settings.module.css";

/** Zoom de la aplicacion: 50-200 %, por defecto 100 %. Se aplica al instante y se recuerda. */
export function ZoomCard() {
  const { t } = useT();
  const zoom = clampZoom(useSettings((s) => s.zoom));
  const setZoom = useSettings((s) => s.setZoom);
  const sliderId = useId();

  return (
    <Card title={t("settings.zoom.title")}>
      <div className={styles.zoom}>
        <p className="muted" style={{ margin: 0 }}>{t("settings.zoom.help")}</p>
        <div className={styles.zoomRow}>
          <Button icon aria-label={t("settings.zoom.decrease")} title={t("settings.zoom.decrease")} disabled={zoom <= ZOOM_MIN}
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
            aria-valuetext={t("settings.zoom.value", { percent: zoom })}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <Button icon aria-label={t("settings.zoom.increase")} title={t("settings.zoom.increase")} disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoom(stepZoom(zoom, 1))}>
            <Plus size={16} />
          </Button>
          <output className={styles.zoomValue} data-testid="zoom-value" aria-live="polite">{t("settings.zoom.value", { percent: zoom })}</output>
          <Button disabled={zoom === ZOOM_DEFAULT} onClick={() => setZoom(ZOOM_DEFAULT)}>
            <RotateCcw size={14} /> {t("settings.zoom.reset", { percent: ZOOM_DEFAULT })}
          </Button>
        </div>
      </div>
    </Card>
  );
}
