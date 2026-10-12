import { Backpack, History, LayoutDashboard, Monitor, ScanSearch, Settings, User, Users, Wrench, X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PokeballIcon } from "../ui";
import { useSession, type ViewId } from "../stores/session";
import { fileName } from "../lib/format";
import { cx } from "../ui";
import { LangSwitch, ThemeToggle } from "./AppearanceControls";
import styles from "./app.module.css";

const NAV: { id: ViewId; icon: ReactNode; needs?: string }[] = [
  { id: "overview", icon: <LayoutDashboard size={17} /> },
  { id: "trainer", icon: <User size={17} />, needs: "trainer" },
  { id: "party", icon: <Users size={17} />, needs: "trainer" },
  { id: "boxes", icon: <Monitor size={17} />, needs: "storage" },
  { id: "bag", icon: <Backpack size={17} />, needs: "bag" },
  { id: "unclassified", icon: <ScanSearch size={17} /> },
  { id: "changes", icon: <History size={17} /> },
  { id: "advanced", icon: <Wrench size={17} /> },
  { id: "settings", icon: <Settings size={17} /> },
];

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

  const roles = profile?.roles ?? {};
  const dirty = pending > 0;

  return (
    <header className={styles.header}>
      <div className={styles.top}>
        <span className={styles.brand}>PBS EDITOR</span>
        {filePath && (
          <span className={styles.fileChip} title={filePath}>
            {fileName(filePath)}
          </span>
        )}
        <span className={styles.spacer} />
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
          <PokeballIcon size={30} />
          {dirty && (
            <span className={styles.centerBadge} aria-label={t("header.pending", { count: pending })}>
              {pending}
            </span>
          )}
        </button>
      </div>
      <nav className={styles.bottom} aria-label="Principal">
        {NAV.filter((n) => !n.needs || roles[n.needs]).map((n) => (
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
