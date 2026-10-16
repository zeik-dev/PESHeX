import { useT } from "../../lib/useT";
import { useSettings, type BallTheme, type ThemePref } from "../../stores/settings";
import { Card, Field, SelectField, Switch } from "../../ui";
import type { LangPref } from "../../i18n";
import shared from "../shared/shared.module.css";

/** Idioma, tema, color de la Poké Ball y copia de seguridad: ajustes de la app que no dependen de ninguna partida. */
export function GeneralCard() {
  const { t } = useT();
  const s = useSettings();
  return (
    <Card>
      <div className={shared.formGrid}>
        <Field label={t("settings.language")}>
          {(id) => (
            <SelectField id={id} value={s.lang as LangPref} onChange={(v) => s.setLang(v)}
              options={[
                { value: "auto", label: t("settings.languageAuto") },
                { value: "es", label: "Español" },
                { value: "en", label: "English" },
              ]} />
          )}
        </Field>
        <Field label={t("settings.theme")}>
          {(id) => (
            <SelectField id={id} value={s.theme as ThemePref} onChange={(v) => s.setTheme(v)}
              options={[
                { value: "auto", label: t("settings.themeAuto") },
                { value: "light", label: t("settings.themeLight") },
                { value: "dark", label: t("settings.themeDark") },
              ]} />
          )}
        </Field>
        <Field label={t("settings.ball")}>
          {(id) => (
            <SelectField id={id} value={s.ball as BallTheme} onChange={(v) => s.setBall(v)}
              options={[
                { value: "classic", label: t("settings.ballClassic") },
                { value: "great", label: t("settings.ballGreat") },
                { value: "ultra", label: t("settings.ballUltra") },
                { value: "master", label: t("settings.ballMaster") },
              ]} />
          )}
        </Field>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
        <Switch checked={s.backup} onChange={s.setBackup} label={t("settings.backup")} />
        {t("settings.backup")}
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <Switch checked={s.autoReload} onChange={s.setAutoReload} label={t("settings.autoReload")} />
        {t("settings.autoReload")}
      </label>
    </Card>
  );
}
