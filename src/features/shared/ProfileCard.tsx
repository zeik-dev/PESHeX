import { Chip, Card } from "../../ui";
import { useT } from "../../lib/useT";
import type { Profile } from "../../api/types";
import styles from "./shared.module.css";

const CONF_TONE = { high: "good", medium: "warn", low: "bad" } as const;

/** Explica que base se detecto, con que confianza, por que y donde esta cada cosa. */
export function ProfileCard({ profile, compact }: { profile: Profile; compact?: boolean }) {
  const { t, dyn } = useT();
  const overlay = profile.overlays[0];

  function overlayWhat(): string {
    const parts: string[] = [];
    for (const ev of overlay?.evidence ?? []) {
      if (ev.code === "root_keys") parts.push(t("profile.overlay.rootKeys", { keys: (ev.params.keys as string[]).join(", ") }));
      if (ev.code === "bag_favourites") parts.push(t("profile.overlay.bagFavourites"));
    }
    return parts.join(" · ");
  }

  return (
    <Card title={t("profile.title")}>
      <div className={styles.stack} style={{ gap: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 16 }}>{dyn(`profile.id.${profile.id}`)}</strong>
          <Chip tone={CONF_TONE[profile.confidence]}>{dyn(`profile.confidence.${profile.confidence}`)}</Chip>
          {profile.confirmed && <Chip tone="info">{t("profile.confirmed")}</Chip>}
        </div>

        <div className={styles.kv}>
          {profile.essentialsVersion && (
            <>
              <span className={styles.kvLabel}>{t("profile.version")}</span>
              <span className={styles.kvValue}>{profile.essentialsVersion}</span>
            </>
          )}
          {profile.gameVersion && (
            <>
              <span className={styles.kvLabel}>{t("profile.gameVersion")}</span>
              <span className={styles.kvValue}>{profile.gameVersion}</span>
            </>
          )}
          <span className={styles.kvLabel}>{t("profile.ids")}</span>
          <span className={styles.kvValue}>
            {profile.idStyle ? dyn(`profile.idStyle.${profile.idStyle}`) : "—"}
            {profile.statLayout ? ` · ${dyn(`profile.statLayout.${profile.statLayout}`)}` : ""}
          </span>
          <span className={styles.kvLabel}>{t("profile.formatLabel")}</span>
          <span className={styles.kvValue}>{dyn(`profile.format.${profile.format}`)}</span>
        </div>

        {overlay && (
          <div>
            <Chip tone="accent">{t("profile.overlay.title")}</Chip>{" "}
            <span className="muted">{t("profile.overlay.sky_v21", { what: overlayWhat() })}</span>
          </div>
        )}

        {profile.ambiguities.map((a) => (
          <div key={a.role} className="muted">
            ⚠ {t("profile.ambiguity", { role: dyn(`profile.roles.${a.role}`) })}
          </div>
        ))}

        {!compact && (
          <>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>{t("profile.evidence.title")}</summary>
              <ul className={styles.list} style={{ marginTop: 6 }}>
                {profile.evidence.map((e, i) => (
                  <li key={i}>{dyn(`profile.evidence.${e.code}`, e.params as Record<string, unknown>)}</li>
                ))}
              </ul>
            </details>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>{t("profile.roles.title")}</summary>
              <table className={styles.extras} style={{ marginTop: 6 }}>
                <tbody>
                  {Object.entries(profile.roles).map(([role, info]) => (
                    <tr key={role}>
                      <td>{dyn(`profile.roles.${role}`)}</td>
                      <td className="mono">{info.path || "—"}</td>
                      <td className="muted">{info.class ?? ""}</td>
                      <td className="muted">{dyn(`profile.via.${info.via}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </div>
    </Card>
  );
}
