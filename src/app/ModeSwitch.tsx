import { useTranslation } from "react-i18next";
import { useSession } from "../stores/session";
import { useSettings } from "../stores/settings";
import { cx } from "../ui";
import styles from "./app.module.css";

/** HeX | HaX: HaX permite cualquier cambio (por defecto); HeX solo cambios legales segun las reglas del juego
 *  y se activa a mano, tras un aviso. */
export function ModeSwitch({ large }: { large?: boolean }) {
  const { t } = useTranslation();
  const mode = useSettings((s) => s.mode);
  const requestMode = useSession((s) => s.requestMode);
  return (
    <div className={cx(styles.modeSwitch, large && styles.modeLarge)} role="radiogroup" aria-label={t("mode.label")}>
      {(["hex", "hax"] as const).map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          className={cx(styles.modeBtn, mode === m && styles.modeOn, mode === m && m === "hax" && styles.modeHax)}
          title={t(m === "hex" ? "mode.hexHelp" : "mode.haxHelp")}
          onClick={() => requestMode(m)}
        >
          {m === "hex" ? "HeX" : "HaX"}
        </button>
      ))}
    </div>
  );
}
