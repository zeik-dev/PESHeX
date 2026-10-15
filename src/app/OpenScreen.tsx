import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppLogo, PokeballSpinner, Button, Tabs, tabId, tabPanelId, cx } from "../ui";
import { errorText } from "../lib/errors";
import { fileName } from "../lib/format";
import { GameLibrary } from "../features/games/GameLibrary";
import { UpdateBadge } from "../features/updater/UpdateBadge";
import { useGames } from "../stores/games";
import { useSession } from "../stores/session";
import { useSettings, type OpenTab } from "../stores/settings";
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

/** Pestaña que se ve al entrar: la última elegida o, si no hay, las recientes (si las hay) y si no, los juegos guardados. */
export function initialOpenTab(saved: OpenTab | null, recentCount: number): OpenTab {
  return saved ?? (recentCount > 0 ? "recent" : "games");
}

export function OpenScreen() {
  const { t } = useTranslation();
  const open = useSession((s) => s.open);
  const opening = useSession((s) => s.opening);
  const openError = useSession((s) => s.openError);
  const recent = useSettings((s) => s.recent);
  const removeRecent = useSettings((s) => s.removeRecent);
  const savedTab = useSettings((s) => s.openTab);
  const setOpenTab = useSettings((s) => s.setOpenTab);
  const gamesCount = useGames((s) => s.games.length);
  const [dropActive, setDropActive] = useState(false);
  // La pestaña se decide al entrar y no salta sola (p. ej. al quitar la última partida reciente se queda en esa pestaña).
  const [tab, setTab] = useState<OpenTab>(() => initialOpenTab(savedTab, recent.length));

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
        <UpdateBadge />
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
          <p className={cx("muted", styles.openSubtitle)}>{t("open.subtitle")}</p>

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

          {!opening && (
            <div className={styles.openTabs} data-testid="open-tabs">
              <Tabs<OpenTab>
                idPrefix="open"
                ariaLabel={t("open.tabsLabel")}
                value={tab}
                onChange={(next) => {
                  setTab(next);
                  setOpenTab(next);
                }}
                tabs={[
                  { id: "recent", label: t("open.tabRecent"), badge: recent.length },
                  { id: "games", label: t("open.tabGames"), badge: gamesCount },
                ]}
              />
              <div
                className={styles.openPanel}
                role="tabpanel"
                id={tabPanelId("open", tab)}
                aria-labelledby={tabId("open", tab)}
                data-testid="open-panel"
              >
                {tab === "recent" ? <RecentList recent={recent} onOpen={(p) => void open(p)} onRemove={removeRecent} /> : <GameLibrary variant="open" showTitle={false} />}
              </div>
            </div>
          )}
        </div>
        <p className={styles.openFoot}>
          {t("open.supported")} · {t("open.backupNote")}
          <br />
          {t("app.disclaimer")}
        </p>
      </div>
    </div>
  );
}

function RecentList({ recent, onOpen, onRemove }: { recent: string[]; onOpen: (path: string) => void; onRemove: (path: string) => void }) {
  const { t } = useTranslation();
  if (recent.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }} data-testid="recent-empty">
        {t("open.recentEmpty")}
      </p>
    );
  }
  return (
    <div className={styles.recentList}>
      {recent.map((p) => (
        <button key={p} type="button" className={styles.recentItem} onClick={() => onOpen(p)} title={p}>
          <FolderOpen size={16} />
          <span style={{ minWidth: 0, flex: 1 }}>
            <div className={styles.recentName}>{fileName(p)}</div>
            <div className={styles.recentPath}>{`\u202a${p}`}</div>
          </span>
          <span
            role="button"
            tabIndex={0}
            aria-label={t("common.remove")}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(p);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), onRemove(p))}
            className="muted"
          >
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
