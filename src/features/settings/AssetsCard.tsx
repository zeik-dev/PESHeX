import { Check, Sparkles, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { gameApi } from "../../api/game";
import type { Suggestion } from "../../game/dhash";
import { findOrphans, referenceSprite } from "../../game/orphans";
import { frameInfo } from "../../game/resolve/common";
import { suggestIcons } from "../../game/suggest";
import { norm } from "../../game/normalize";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { toastError } from "../../stores/session";
import { Button, Card, Chip, ComboBox, GameImage, PokemonIcon } from "../../ui";
import shared from "../shared/shared.module.css";

const PAGE = 25;

/** Iconos de Pokemon que la convencion de nombres no encontro: asignarlos a mano o aceptar una sugerencia por parecido. */
export function AssetsCard() {
  const { t } = useT();
  const ctx = useGame((s) => s.ctx);
  const catalog = useGame((s) => s.catalog);
  const map = useGame((s) => s.map);
  const setMapping = useGame((s) => s.setMapping);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [sugg, setSugg] = useState<Map<string, Suggestion[]>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancel = useRef({ cancelled: false });

  const report = useMemo(() => (ctx && catalog ? findOrphans(ctx, catalog.species) : null), [ctx, catalog]);
  const options = useMemo(
    () => (report?.orphans ?? []).map((o) => ({ id: o.path, label: o.name, sub: o.path.split("/").slice(-2, -1)[0] })),
    [report],
  );
  const refs = useMemo(
    () =>
      ctx && report
        ? report.missing.flatMap((m) => {
            const reference = referenceSprite(ctx, m);
            return reference ? [{ species: m, reference }] : [];
          })
        : [],
    [ctx, report],
  );

  if (!ctx || !catalog || !report || !ctx.layout.pokemonIcons) return null;
  const manual = Object.entries(map.pokemon.icon);
  if (report.missing.length === 0 && manual.length === 0) return null;

  const needle = norm(q);
  const list = report.missing.filter((m) => !needle || norm(m.name).includes(needle) || norm(m.species).includes(needle));

  async function runSuggest() {
    if (!ctx || !report) return;
    cancel.current = { cancelled: false };
    setProgress({ done: 0, total: 1 });
    try {
      const result = await suggestIcons(gameApi.readFile, refs, report.orphans, {
        signal: cancel.current,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (!cancel.current.cancelled) setSugg(result);
    } catch (e) {
      toastError(e);
    } finally {
      setProgress(null);
    }
  }

  const iconOf = (path: string) => {
    const e = ctx.index.byPath(path);
    if (!e) return null;
    const f = frameInfo(e.w, e.h);
    return <GameImage rel={path} size={32} frames={f.frames} frameRatio={f.frameH > 0 ? f.frameW / f.frameH : 1} />;
  };

  return (
    <Card title={t("assets.title")}>
      <div className={shared.stack}>
        <p className="muted">{t("assets.intro")}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Chip tone={report.missing.length ? "warn" : "good"}>{t("assets.missing", { count: report.missing.length })}</Chip>
          <Chip>{t("assets.orphans", { count: report.orphans.length })}</Chip>
          {refs.length > 0 && report.orphans.length > 0 && (
            <Button size="sm" disabled={!!progress} onClick={() => void runSuggest()}>
              <Sparkles size={14} /> {t("assets.suggest")}
            </Button>
          )}
          {progress && (
            <>
              <span className="muted" role="status">{t("assets.suggesting", { done: progress.done, total: progress.total })}</span>
              <Button size="sm" variant="ghost" onClick={() => (cancel.current.cancelled = true)}>{t("common.cancel")}</Button>
            </>
          )}
        </div>
        {sugg.size > 0 && <p className="muted" style={{ fontSize: 12 }}>{t("assets.suggestNote")}</p>}

        {report.missing.length > 0 && (
          <>
            <input className="mono" style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
              aria-label={t("assets.search")} placeholder={t("assets.search")} value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} />
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }} aria-label={t("assets.title")}>
              {list.slice(0, shown).map((m) => {
                const s = sugg.get(m.key)?.[0];
                return (
                  <li key={m.key} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <PokemonIcon name={m.name} species={m.species} number={m.number ?? undefined} size={32} />
                    <strong style={{ minWidth: 120 }}>{m.name}</strong>
                    <div style={{ minWidth: 220, flex: "1 1 220px", maxWidth: 360 }}>
                      <ComboBox value={null} options={options} mono ariaLabel={`${m.name} — ${t("assets.assign")}`} placeholder={t("assets.assign")}
                        onChange={(path) => path && void setMapping("pokemon.icon", m.key, path)} />
                    </div>
                    {s && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {iconOf(s.path)}
                        <span className="muted mono" style={{ fontSize: 12 }} title={s.path}>{s.path.split("/").pop()}</span>
                        <Button size="sm" onClick={() => void setMapping("pokemon.icon", m.key, s.path)}>
                          <Check size={14} /> {t("assets.accept")}
                        </Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {list.length > shown && <Button onClick={() => setShown((n) => n + PAGE)}>{t("assets.more", { count: list.length - shown })}</Button>}
          </>
        )}

        {manual.length > 0 && (
          <div>
            <strong>{t("assets.manual", { count: manual.length })}</strong>
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {manual.map(([key, path]) => (
                <li key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {iconOf(path)}
                  <span className="mono" style={{ fontSize: 12 }}>{key} → {path.split("/").pop()}</span>
                  <Button size="sm" variant="ghost" icon aria-label={t("assets.remove")} title={t("assets.remove")} onClick={() => void setMapping("pokemon.icon", key, null)}>
                    <X size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
