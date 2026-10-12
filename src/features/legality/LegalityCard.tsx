import { useMemo } from "react";
import { useT } from "../../lib/useT";
import { usePc } from "../../stores/pc";
import { useSession } from "../../stores/session";
import { useSettings } from "../../stores/settings";
import { Button, Card, Chip, PokeballSpinner } from "../../ui";
import { LegalityBlock } from "../settings/GameFolderCard";
import { FlagList } from "./FlagList";
import { useLegality } from "./useLegality";
import styles from "./legality.module.css";

/** Resumen de legalidad de toda la partida: modo, conteos, cobertura y los Pokémon con problemas. */
export function LegalityCard() {
  const { t } = useT();
  const mode = useSettings((s) => s.mode);
  const setView = useSession((s) => s.setView);
  const select = usePc((s) => s.select);
  const setBox = usePc((s) => s.setBox);
  const q = useLegality();
  const report = q.data;

  const rows = useMemo(() => {
    if (!report) return [];
    return Object.entries(report.flags)
      .map(([ref, flags]) => ({ ref, flags: flags.filter((f) => f.severity !== "info") }))
      .filter((r) => r.flags.length > 0)
      .sort((a, b) => Number(b.flags.some((f) => f.severity === "illegal")) - Number(a.flags.some((f) => f.severity === "illegal")))
      .slice(0, 8);
  }, [report]);

  function show(ref: string) {
    select(ref);
    if (ref.startsWith("box/")) {
      setBox(Number(ref.split("/")[1]));
      setView("boxes");
    } else if (ref.startsWith("party/")) {
      setView("party");
    } else {
      setView(ref === "trainer" ? "trainer" : ref === "bag" ? "bag" : "party");
    }
  }

  return (
    <Card title={t("legality.title")}>
      {!report ? (
        <PokeballSpinner size={28} label={t("legality.checking")} />
      ) : (
        <div className={styles.rowText} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={styles.counts}>
            <Chip tone={mode === "hex" ? "accent" : "warn"}>{mode === "hex" ? "HeX" : "HaX"}</Chip>
            {report.summary.illegal === 0 && report.summary.warning === 0 ? (
              <Chip tone="good">{t("legality.ok")}</Chip>
            ) : (
              <>
                {report.summary.illegal > 0 && <Chip tone="bad">{t("legality.illegal", { count: report.summary.illegal })}</Chip>}
                {report.summary.warning > 0 && <Chip tone="warn">{t("legality.warning", { count: report.summary.warning })}</Chip>}
              </>
            )}
            <span className="muted" style={{ fontSize: 12 }}>
              {t("legality.checkedRules", { count: report.coverage.evaluated.length })}
              {report.coverage.skipped.length > 0 && ` · ${t("legality.skippedRules", { count: report.coverage.skipped.length })}`}
            </span>
          </div>
          <LegalityBlock />
          {rows.length > 0 && (
            <div>
              <strong>{t("legality.flagged")}</strong>
              {rows.map((r) => (
                <div key={r.ref} className={styles.row}>
                  <div className={styles.rowText}>
                    <FlagList flags={r.flags.map((f) => ({ ...f, ref: r.ref }))} showRef limit={2} />
                  </div>
                  <Button size="sm" onClick={() => show(r.ref)}>{t("legality.view")}</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
