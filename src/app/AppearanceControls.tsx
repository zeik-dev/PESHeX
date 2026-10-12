import { Moon, Sun, SunMoon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { effectiveLang, useSettings, type ThemePref } from "../stores/settings";
import styles from "./app.module.css";

/** Selector ES|EN. Resalta el idioma efectivo; al pulsar fija la preferencia. */
export function LangSwitch() {
  const { t } = useTranslation();
  const pref = useSettings((s) => s.lang);
  const setLang = useSettings((s) => s.setLang);
  const current = effectiveLang(pref);
  return (
    <div className={styles.langSwitch} role="group" aria-label={t("header.language")}>
      {(["es", "en"] as const).map((l) => (
        <button key={l} type="button" className={styles.langBtn} aria-pressed={current === l} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

const NEXT: Record<ThemePref, ThemePref> = { auto: "light", light: "dark", dark: "auto" };

/** Alterna automatico -> claro -> oscuro. */
export function ThemeToggle() {
  const { t } = useTranslation();
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : SunMoon;
  const label = `${t("header.theme")}: ${t(`settings.theme${theme[0].toUpperCase()}${theme.slice(1)}` as never) as string}`;
  return (
    <button type="button" className={styles.hbtn} onClick={() => setTheme(NEXT[theme])} aria-label={label} title={label}>
      <Icon size={18} />
    </button>
  );
}
