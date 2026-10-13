import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Unlink } from "lucide-react";
import { useMemo } from "react";
import { resolvePokemonIcon } from "../../game/resolve/pokemon";
import type { CalStatus } from "../../game/types";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { useSession } from "../../stores/session";
import { useHexMode } from "../../stores/settings";
import { Banner, Button, Card, Chip } from "../../ui";
import shared from "../shared/shared.module.css";
import { GameLinkProgress } from "./GameFolderPrompt";

const TONE: Record<CalStatus, "good" | "bad" | "warn"> = { ok: "good", mismatch: "bad", unknown: "warn" };

/** Vincular/desvincular la carpeta del juego y ver lo que se pudo leer de ella. */
export function GameFolderCard() {
  const { t, dyn } = useT();
  const game = useGame();
  const filePath = useSession((s) => s.filePath);
  const pending = useSession((s) => s.pendingCount);
  const hex = useHexMode();
  const { status, linking, ctx, catalog, scanTruncated } = game;

  const icons = useMemo(() => {
    if (!ctx || !catalog) return null;
    const base = catalog.species.filter((s) => s.form === 0);
    const found = base.filter((s) => {
      const r = resolvePokemonIcon(ctx, { species: s.id });
      return r != null && r.via !== "generic";
    }).length;
    return { found, total: base.length };
  }, [ctx, catalog]);

  async function choose() {
    const dir = await openDialog({ directory: true, multiple: false, title: t("game.dialogTitle") });
    if (typeof dir === "string") await game.link(dir, "manual", filePath);
  }

  const limitSources = status.limitSources ?? {};
  const limitKeys = Object.keys(limitSources);

  return (
    <Card title={t("game.title")}>
      <div className={shared.stack}>
        <p className="muted">{t("game.intro")}</p>

        {linking && <GameLinkProgress />}

        {!linking && !status.linked && (
          <div>
            <Button variant="primary" onClick={() => void choose()}>
              <FolderOpen size={16} /> {t("game.choose")}
            </Button>
          </div>
        )}

        {!linking && status.linked && (
          <>
            <div className={shared.kv}>
              <span className={shared.kvLabel}>{t("game.folder")}</span>
              <span className={shared.kvValue + " mono"} title={status.root}>{status.root}</span>
              {status.title && (
                <>
                  <span className={shared.kvLabel}>{t("game.gameTitle")}</span>
                  <span className={shared.kvValue}>{status.title}</span>
                </>
              )}
              <span className={shared.kvLabel}>{t("game.version")}</span>
              <span className={shared.kvValue}>
                {status.data?.version ?? "—"} · {status.source ? t(`game.source.${status.source}`) : ""}
              </span>
            </div>

            {status.folder?.encrypted && <Banner tone="warn" title={t("game.encryptedTitle")}>{t("game.encrypted")}</Banner>}
            {status.data && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <Chip tone={status.data.state === "ready" ? "good" : status.data.state === "partial" ? "warn" : "bad"}>
                  {t(`game.dataState.${status.data.state}`)}
                </Chip>
                {(["species", "moves", "items", "abilities", "types"] as const).map((d) => {
                  const info = status.data!.domains[d];
                  return (
                    <Chip key={d} tone={info.count > 0 ? undefined : "bad"} title={info.error ?? undefined}>
                      {t(`game.domain.${d}`)}: {info.count} · {t(`game.domainSource.${info.source}`)}
                    </Chip>
                  );
                })}
              </div>
            )}

            <div>
              <strong>{t("game.assets")}</strong>
              {!status.folder?.hasGraphics ? (
                <p className="muted">{t("game.noGraphics")}</p>
              ) : (
                <p className="muted">
                  {game.index ? t("game.assetsFound", { count: game.index.size }) : "—"}{" "}
                  {scanTruncated && t("game.assetsTruncated")}
                  {game.layout && <> · {t(`game.layout.${game.layout.family}`)}</>}
                  {icons && <> · {t("game.iconsResolved", { found: icons.found, total: icons.total })}</>}
                </p>
              )}
            </div>

            <div>
              <strong>{t("game.limits")}</strong>
              {limitKeys.length === 0 ? (
                <p className="muted">{t("game.limitsNone")}</p>
              ) : (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {limitKeys.map((k) => (
                    <Chip key={k} title={limitSources[k]}>
                      {dyn(`game.limitName.${k}`)}: {status.limits?.[k]}
                    </Chip>
                  ))}
                </div>
              )}
            </div>

            {status.calibration && (
              <div>
                <strong>{t("game.calibration")}</strong>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {(["species", "stats", "exp", "moves", "abilities"] as const).map((d) => {
                    const c = status.calibration![d];
                    return (
                      <Chip key={d} tone={TONE[c.status]}
                        title={c.ratio != null ? `${c.matched}/${c.checked}` : undefined}>
                        {t(`game.calDomain.${d}`)}: {t(`game.calStatus.${c.status}`)}
                      </Chip>
                    );
                  })}
                </div>
              </div>
            )}

            {hex && <LegalityBlock />}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button disabled={pending > 0} onClick={() => void choose()}>
                <FolderOpen size={16} /> {t("game.change")}
              </Button>
              <Button variant="ghost" disabled={pending > 0} onClick={() => void game.unlink()}>
                <Unlink size={16} /> {t("game.unlink")}
              </Button>
            </div>
            {pending > 0 && <p className="muted" style={{ fontSize: 12 }}>{t("game.pendingBlock")}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

/** Nivel de legalidad que permiten los datos vinculados y por que (reutilizable). */
export function LegalityBlock() {
  const { t, dyn } = useT();
  const { level, reasons } = useGame((s) => s.status.legality);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Chip tone={level === "full" ? "good" : level === "partial" ? "warn" : "info"}>{t(`game.level.${level}`)}</Chip>
        <span className="muted" style={{ fontSize: 13 }}>{t(`game.levelHelp.${level}`)}</span>
      </div>
      {reasons.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }} className="muted">
          {reasons.map((r) => (
            <li key={r}>{dyn(`game.reason.${r}`)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
