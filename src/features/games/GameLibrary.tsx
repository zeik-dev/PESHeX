import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronRight, FolderOpen, FolderSearch, Gamepad2, Plus, RefreshCw, Trash2, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { GameEntry, SaveFile, SaveScan } from "../../api/games";
import { formatDateTime } from "../../lib/format";
import { useT } from "../../lib/useT";
import { useGames } from "../../stores/games";
import { useSession } from "../../stores/session";
import { Button, Chip, LoadProgress, cx } from "../../ui";
import styles from "./games.module.css";

/** «Mis juegos»: los fangames registrados, con las partidas que el Save Scan encontró de cada uno (sin copias `.bak`), la
 *  precarga de sus datos y la elección manual de la carpeta de guardados cuando el escaneo no la encuentra.
 *  `variant="open"` (pantalla de inicio) deja abrir las partidas; `"manage"` (Ajustes) solo gestiona. */
export function GameLibrary({ variant }: { variant: "open" | "manage" }) {
  const { t } = useT();
  const games = useGames((s) => s.games);
  const loaded = useGames((s) => s.loaded);
  const add = useGames((s) => s.add);
  const rescanAll = useGames((s) => s.rescanAll);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Al mostrar la biblioteca se vuelven a buscar las partidas de cada juego (es barato y así la lista está al día).
  const ids = games.map((g) => g.id).join(",");
  useEffect(() => {
    if (ids) void rescanAll();
  }, [ids, rescanAll]);

  async function pickGame() {
    const dir = await openDialog({ directory: true, multiple: false, title: t("games.pickDialog") });
    if (typeof dir !== "string") return;
    const g = await add(dir);
    if (g) setOpen((o) => ({ ...o, [g.id]: true }));
  }

  return (
    <section className={styles.library} aria-label={t("games.title")} data-testid="game-library">
      <header className={styles.head}>
        {/* En Ajustes la tarjeta ya lleva el título. */}
        {variant === "open" ? (
          <h2 className={styles.title}>
            <Gamepad2 size={18} aria-hidden="true" /> {t("games.title")}
          </h2>
        ) : (
          <span />
        )}
        <Button size="sm" onClick={() => void pickGame()}>
          <Plus size={14} /> {t("games.add")}
        </Button>
      </header>
      {loaded && games.length === 0 && <p className="muted" style={{ margin: 0 }}>{t("games.empty")}</p>}
      <div className={styles.list}>
        {games.map((g, i) => (
          <GameCard
            key={g.id}
            game={g}
            variant={variant}
            expanded={open[g.id] ?? (variant === "open" && i === 0)}
            onToggle={() => setOpen((o) => ({ ...o, [g.id]: !(o[g.id] ?? (variant === "open" && i === 0)) }))}
          />
        ))}
      </div>
    </section>
  );
}

function GameCard({ game, variant, expanded, onToggle }: { game: GameEntry; variant: "open" | "manage"; expanded: boolean; onToggle: () => void }) {
  const { t, dyn, locale } = useT();
  const scan = useGames((s) => s.scans[game.id]);
  const progress = useGames((s) => s.preload[game.id]);
  const { rescan, remove, addSaveDir, removeSaveDir, startPreload } = useGames.getState();
  const openSave = useSession((s) => s.open);
  const count = scan ? scan.files.length : (game.lastScan?.count ?? 0);

  async function pickSaveDir() {
    const dir = await openDialog({ directory: true, multiple: false, title: t("games.pickSaveDirDialog") });
    if (typeof dir === "string") await addSaveDir(game.id, dir);
  }

  return (
    <article className={styles.card} data-testid="game-card" data-game={game.id}>
      <div className={styles.cardHead}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={expanded}
          aria-label={t("games.expand", { name: game.name })}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          <span className={styles.names}>
            <strong className={styles.name}>{game.name}</strong>
            <span className={cx(styles.path, "mono")} title={game.root}>{game.root}</span>
          </span>
        </button>
        <span className={styles.chips}>
          <Chip tone={count > 0 ? "good" : "warn"}>{count > 0 ? t("games.saves", { count }) : t("games.noSaves")}</Chip>
          {game.indexedAt != null && <Chip tone="info">{t("games.preloaded")}</Chip>}
        </span>
      </div>

      {expanded && (
        <div className={styles.body}>
          {progress ? (
            <div className={styles.progress}>
              <LoadProgress value={progress.total > 0 ? progress.done / progress.total : 0} label={dyn(`game.step.${progress.step}`)} />
              <p className="muted" style={{ margin: 0, fontSize: 12 }} data-testid="game-progress-hint">{t("game.progressHint")}</p>
            </div>
          ) : null}

          {scan && scan.files.length > 0 ? (
            <SaveList scan={scan} variant={variant} locale={locale} onOpen={(f) => void openSave(f.path)} />
          ) : (
            <p className="muted" style={{ margin: 0 }}>{t("games.noSavesBody")}</p>
          )}

          {game.saveDirs.length > 0 && (
            <div className={styles.dirs}>
              <span className="muted">{t("games.manualDirs")}</span>
              {game.saveDirs.map((d) => (
                <span key={d} className={styles.dir}>
                  <span className="mono" title={d}>{d}</span>
                  <button type="button" className={styles.dirRemove} aria-label={t("games.removeDir", { dir: d })} title={t("games.removeDir", { dir: d })} onClick={() => void removeSaveDir(game.id, d)}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className={styles.actions}>
            <Button size="sm" onClick={() => void pickSaveDir()}>
              <FolderOpen size={14} /> {t("games.pickSaveDir")}
            </Button>
            <Button size="sm" onClick={() => void rescan(game.id)}>
              <RefreshCw size={14} /> {t("games.rescan")}
            </Button>
            <Button size="sm" disabled={!!progress} title={t("games.preloadHint")} onClick={() => void startPreload(game.id)}>
              <Zap size={14} /> {progress ? t("games.preloading") : t("games.preload")}
            </Button>
            <span className={styles.spacer} />
            <Button size="sm" variant="ghost" title={t("games.removeHint")} onClick={() => void remove(game.id)}>
              <Trash2 size={14} /> {t("games.remove")}
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function SaveList({ scan, variant, locale, onOpen }: { scan: SaveScan; variant: "open" | "manage"; locale: string; onOpen: (f: SaveFile) => void }) {
  const { t } = useT();
  return (
    <div>
      <div className={cx(styles.savesDir, "muted")}>
        {t("games.savesIn")} <span className="mono" title={scan.dir ?? ""}>{scan.dir}</span>
      </div>
      <ul className={styles.saves}>
        {scan.files.map((f) => (
          <li key={f.path} className={styles.save}>
            <FolderSearch size={16} aria-hidden="true" />
            <span className={styles.saveText}>
              <strong>{f.name}</strong>
              <span className="muted">
                {f.modified != null ? t("games.modified", { date: formatDateTime(new Date(f.modified * 1000).toISOString(), locale) }) : ""}
              </span>
            </span>
            {variant === "open" && (
              <Button size="sm" variant="primary" aria-label={t("games.openSave", { name: f.name })} onClick={() => onOpen(f)}>
                {t("games.open")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
