import { useTranslation } from "react-i18next";
import { useSession } from "../stores/session";
import { useSettings } from "../stores/settings";
import { cx } from "../ui";
import styles from "./app.module.css";

/** HeX | HaX: HeX solo permite cambios legales segun las reglas del juego; HaX permite cualquiera. */
export function ModeSwitch({ large }: { large?: boolean }) {
  const { t } = useTranslation();
  const mode = useSettings((s) => s.mode);
  const changeMode = useSession((s) => s.changeMode);
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
          onClick={() => void changeMode(m)}
        >
          {m === "hex" ? "HeX" : "HaX"}
        </button>
      ))}
    </div>
  );
}

/** Franja de aviso mientras HaX esta activo. */
export function HaxStrip() {
  const { t } = useTranslation();
  const mode = useSettings((s) => s.mode);
  if (mode !== "hax") return null;
  return (
    <div className={styles.haxStrip} role="status">
      {t("mode.haxBanner")}
    </div>
  );
}
