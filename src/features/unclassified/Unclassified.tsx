import { ScanSearch } from "lucide-react";
import { useState } from "react";
import { semantic } from "../../api/semantic";
import type { Bucket } from "../../api/types";
import { useT } from "../../lib/useT";
import { useSession } from "../../stores/session";
import { bucketColor, Button, Card, CoverageMeter, EmptyState, PageTitle, PokeballSpinner } from "../../ui";
import shared from "../shared/shared.module.css";
import { useSemanticQuery } from "../queries";
import styles from "./unclassified.module.css";

const BUCKETS: Bucket[] = ["classified", "custom", "world", "unclassified"];

/** Lista completa de lo que contiene el save y como se clasifico cada grupo. */
export function Unclassified() {
  const { t, dyn, locale } = useT();
  const locate = useSession((s) => s.locateInAdvanced);
  // null = elegir solo: "Sin clasificar" si hay algo, y "Todos" si no.
  const [picked, setPicked] = useState<Bucket | "" | null>(null);
  const [query, setQuery] = useState("");
  const cov = useSemanticQuery("coverage", semantic.coverage);
  const bucket: Bucket | "" = picked ?? (cov.data && cov.data.buckets.unclassified > 0 ? "unclassified" : "");
  const setBucket = (b: Bucket | "") => setPicked(b);
  const list = useSemanticQuery(["unclassified", bucket, query], () => semantic.unclassified({ bucket, q: query, pageSize: 200 }), !!cov.data);

  if (!cov.data) return <PokeballSpinner />;
  const c = cov.data;
  const groups = list.data?.groups ?? [];

  return (
    <div className={shared.stack}>
      <PageTitle icon={<ScanSearch />} title={t("unclassified.title")} subtitle={t("unclassified.subtitle")} />

      <Card title={t("unclassified.coverage")}>
        <CoverageMeter buckets={c.buckets} total={c.total} />
        <div className={styles.hints}>
          {BUCKETS.map((b) => (
            <div key={b} className={styles.hint}>
              <span className={styles.dot} style={{ background: bucketColor(b) }} />
              <span><strong>{dyn(`unclassified.bucket.${b}`)}</strong> — <span className="muted">{dyn(`unclassified.bucketHint.${b}`)}</span></span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className={styles.filters}>
          <div className={styles.chips} role="group">
            {(["", ...BUCKETS] as (Bucket | "")[]).map((b) => (
              <button key={b || "all"} type="button" className={styles.filterChip} aria-pressed={bucket === b} onClick={() => setBucket(b)}>
                {b ? dyn(`unclassified.bucket.${b}`) : t("unclassified.all")}
                {b ? <span className="muted"> {c.buckets[b].toLocaleString(locale)}</span> : null}
              </button>
            ))}
          </div>
          <input className={styles.search} placeholder={t("unclassified.search")} aria-label={t("unclassified.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {list.isPending ? (
          <PokeballSpinner size={28} />
        ) : groups.length === 0 ? (
          <EmptyState>{bucket === "unclassified" && !query ? t("unclassified.allClassified") : t("unclassified.noGroups")}</EmptyState>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              {t("unclassified.showing", { shown: groups.length, total: list.data!.total })}
            </div>
            <div className={styles.tableWrap}>
              <table className={shared.extras}>
                <thead>
                  <tr>
                    <th>{t("unclassified.colKey")}</th>
                    <th>{t("unclassified.colBucket")}</th>
                    <th style={{ textAlign: "right" }}>{t("unclassified.colLeaves")}</th>
                    <th>{t("unclassified.colPath")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={`${g.key}-${g.bucket}`}>
                      <td className="mono">{g.key}</td>
                      <td>
                        <span className={styles.dot} style={{ background: bucketColor(g.bucket) }} /> {dyn(`unclassified.bucket.${g.bucket}`)}
                      </td>
                      <td style={{ textAlign: "right" }} className="mono">{g.leafCount.toLocaleString(locale)}</td>
                      <td className="mono muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.samplePath}>
                        {g.samplePath || "—"}
                      </td>
                      <td><Button size="sm" variant="ghost" onClick={() => locate(g.samplePath)}>{t("unclassified.locate")}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
