import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLogo, PokeballSpinner, Button, cx } from "../ui";
import { errorText } from "../lib/errors";
import { fileName } from "../lib/format";
import { GameLibrary } from "../features/games/GameLibrary";
import { useSession } from "../stores/session";
import { useSettings } from "../stores/settings";
import { LangSwitch, ThemeToggle } from "./AppearanceControls";
import styles from "./app.module.css";

/** Escucha el arrastrar-y-soltar nativo de Tauri (da rutas reales). Si no hay
 *  runtime de Tauri (navegador, tests) simplemente no hace nada. */
function useFileDrop(onPath: (p: string) => void, setActive: (a: boolean) => void) {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/webview")
      .then(async ({ getCurrentWebview }) => {
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === "enter" || p.type === "over") setActive(true);
          else if (p.type === "leave") setActive(false);
          else if (p.type === "drop") {
            setActive(false);
            const path = p.paths.find((x) => /\.rxdata$/i.test(x)) ?? p.paths[0];
            if (path) onPath(path);
          }
        });
        if (cancelled) un();
        else unlisten = un;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onPath, setActive]);
}

export function OpenScreen() {
  const { t } = useTranslation();
  const open = useSession((s) => s.open);
  const opening = useSession((s) => s.opening);
  const openError = useSession((s) => s.openError);
  const recent = useSettings((s) => s.recent);
  const removeRecent = useSettings((s) => s.removeRecent);
  const [dropActive, setDropActive] = useState(false);

  useFileDrop((p) => void open(p), setDropActive);

  async function pick() {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: t("open.dialogFilter"), extensions: ["rxdata"] }],
    });
    if (typeof selected === "string") void open(selected);
  }

  return (
    <div className={styles.openPage}>
      <div className={styles.openTools}>
        <LangSwitch />
        <ThemeToggle />
      </div>
      <div className={styles.openCenter}>
        <div className={styles.openCard}>
          <div className={styles.openBall}>
            <AppLogo size={96} title={t("app.fullName")} />
          </div>
          <div className={styles.openTitle}>{t("app.name")}</div>
          <h1 style={{ fontSize: 20 }}>{t("open.title")}</h1>
          <p className="muted">{t("open.subtitle")}</p>

          {opening ? (
            <PokeballSpinner label={t("open.opening")} />
          ) : (
            <>
              <Button variant="primary" onClick={() => void pick()}>
                <FolderOpen size={18} /> {t("open.button")}
              </Button>
              <div className={cx(styles.dropZone, dropActive && styles.dropActive)}>
                {dropActive ? t("open.dropActive") : t("open.drop")}
              </div>
            </>
          )}

          {openError && (
            <p className={styles.errorText} role="alert">
              {t("open.error")}: {errorText(t, openError)}
            </p>
          )}

          {recent.length > 0 && !opening && (
            <div className={styles.recentList}>
              <strong style={{ fontSize: 13 }}>{t("open.recent")}</strong>
              {recent.map((p) => (
                <button key={p} type="button" className={styles.recentItem} onClick={() => void open(p)} title={p}>
                  <FolderOpen size={16} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className={styles.recentName}>{fileName(p)}</div>
                    <div className={styles.recentPath}>{`‪${p}`}</div>
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={t("common.remove")}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRecent(p);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), removeRecent(p))}
                    className="muted"
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

          <p className="muted" style={{ fontSize: 12 }}>
            {t("open.supported")} · {t("open.backupNote")}
          </p>
          <p className={styles.disclaimer}>{t("app.disclaimer")}</p>
        </div>
        {!opening && (
          <div className={styles.libraryCard}>
            <GameLibrary variant="open" />
          </div>
        )}
      </div>
    </div>
  );
}
