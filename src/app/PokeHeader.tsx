import { Redo2, Search, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppLogo } from "../ui";
import { useSession } from "../stores/session";
import { useUi } from "../stores/ui";
import { fileName } from "../lib/format";
import { cx } from "../ui";
import { LangSwitch, ThemeToggle } from "./AppearanceControls";
import { ModeSwitch } from "./ModeSwitch";
import { visibleNav } from "./nav";
import styles from "./app.module.css";

/** Cabecera en dos mitades como una Poké Ball: franja superior (color primario),
 *  costura oscura con el boton central (= Guardar) y franja inferior con la navegacion. */
export function PokeHeader() {
  const { t } = useTranslation();
  const filePath = useSession((s) => s.filePath);
  const profile = useSession((s) => s.profile);
  const view = useSession((s) => s.view);
  const setView = useSession((s) => s.setView);
  const pending = useSession((s) => s.pendingCount);
  const saving = useSession((s) => s.saving);
  const save = useSession((s) => s.save);
  const close = useSession((s) => s.close);
  const undo = useSession((s) => s.undo);
  const redo = useSession((s) => s.redo);
  const redoCount = useSession((s) => s.redoCount);
  const setPalette = useUi((s) => s.setPalette);

  const roles = profile?.roles ?? {};
  const dirty = pending > 0;

  return (
    <header className={styles.header}>
      <div className={styles.top}>
        <span className={styles.brand}>{t("app.name")}</span>
        {filePath && (
          <span className={styles.fileChip} title={filePath}>
            {fileName(filePath)}
          </span>
        )}
        <span className={styles.spacer} />
        <button type="button" className={styles.hbtn} onClick={() => setPalette(true)} aria-label={t("palette.open")} title={t("palette.openHint")}>
          <Search size={16} /> <span className={styles.hideNarrow}>{t("palette.short")}</span>
        </button>
        <button type="button" className={styles.hbtn} disabled={!dirty} onClick={() => void undo()} aria-label={t("common.undo")} title={t("shortcuts.undo")}>
          <Undo2 size={16} />
        </button>
        <button type="button" className={styles.hbtn} disabled={redoCount === 0} onClick={() => void redo()} aria-label={t("common.redo")} title={t("shortcuts.redo")}>
          <Redo2 size={16} />
        </button>
        <ModeSwitch />
        <LangSwitch />
        <ThemeToggle />
        <button type="button" className={styles.hbtn} onClick={() => void close()}>
          <X size={16} /> {t("header.closeFile")}
        </button>
      </div>
      <div className={styles.seam}>
        <button
          type="button"
          className={cx(styles.centerBtn, dirty && styles.dirty)}
          disabled={!dirty || saving}
          onClick={() => void save()}
          aria-label={dirty ? t("header.save") : t("header.nothingToSave")}
          title={dirty ? t("header.saveHint") : t("header.nothingToSave")}
        >
          <AppLogo size={32} />
          {dirty && (
            <span className={styles.centerBadge} aria-label={t("header.pending", { count: pending })}>
              {pending}
            </span>
          )}
        </button>
      </div>
      <nav className={styles.bottom} aria-label="Principal">
        {visibleNav(roles).map((n) => (
          <button
            key={n.id}
            type="button"
            className={styles.navBtn}
            aria-current={view === n.id ? "page" : undefined}
            onClick={() => setView(n.id)}
          >
            {n.icon}
            {t(`nav.${n.id}` as never) as string}
            {n.id === "changes" && dirty && <span className={styles.navBadge}>{pending}</span>}
          </button>
        ))}
      </nav>
    </header>
  );
}
