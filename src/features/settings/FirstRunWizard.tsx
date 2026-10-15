import { Languages } from "lucide-react";
import { effectiveLang, useSettings } from "../../stores/settings";
import { useT } from "../../lib/useT";
import { Button, Modal, cx } from "../../ui";
import styles from "./settings.module.css";

/** Asistente del primer arranque: primero se elige el idioma (por defecto español; se aplica al instante, el propio asistente
 *  cambia de idioma al elegir). Se muestra una sola vez; quien ya usaba la app (ajustes anteriores) no pasa por él. */
export function FirstRunWizard() {
  const { t } = useT();
  const done = useSettings((s) => s.firstRunDone);
  const pref = useSettings((s) => s.lang);
  const setLang = useSettings((s) => s.setLang);
  const finish = useSettings((s) => s.setFirstRunDone);
  const current = effectiveLang(pref);

  return (
    <Modal
      open={!done}
      title={t("firstRun.title")}
      onClose={() => finish(true)}
      footer={
        <Button variant="primary" onClick={() => finish(true)}>
          {t("firstRun.finish")}
        </Button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0 }}>{t("firstRun.langBody")}</p>
        <div className={styles.langChoices} role="radiogroup" aria-label={t("firstRun.langLabel")}>
          {(["es", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={current === l}
              className={cx(styles.langChoice, current === l && styles.langChoiceOn)}
              onClick={() => setLang(l)}
            >
              <Languages size={18} aria-hidden="true" />
              {l === "es" ? "Español" : "English"}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
