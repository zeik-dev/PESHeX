import { LayoutDashboard } from "lucide-react";
import { semantic } from "../../api/semantic";
import { useT } from "../../lib/useT";
import { displayName, genderSymbol } from "../../lib/pokemon";
import { formatDateTime, formatDuration, formatMoney, formatNumber } from "../../lib/format";
import { useSession } from "../../stores/session";
import { Banner, Button, Card, CoverageMeter, EmptyState, PageTitle, PokeballSpinner, PokemonIcon, Sprite, Chip } from "../../ui";
import { ProfileCard } from "../shared/ProfileCard";
import shared from "../shared/shared.module.css";
import { LegalityCard } from "../legality/LegalityCard";
import { useSemanticQuery } from "../queries";
import styles from "./overview.module.css";

export function Overview() {
  const { t, locale } = useT();
  const profile = useSession((s) => s.profile);
  const roundtrip = useSession((s) => s.roundtrip);
  const setView = useSession((s) => s.setView);
  const openEditor = useSession((s) => s.openEditor);
  const q = useSemanticQuery("overview", semantic.overview);
  const cov = useSemanticQuery("coverage", semantic.coverage);

  if (!q.data) return <PokeballSpinner />;
  const ov = q.data;
  const tr = ov.trainer;
  const c = ov.counts;

  return (
    <div className={shared.stack}>
      <PageTitle icon={<LayoutDashboard />} title={t("nav.overview")} />

      {roundtrip && !roundtrip.roundtripClean && (
        <Banner tone="warn" title={t("banner.roundtripTitle")}>
          {t("banner.roundtripBody", { byte: roundtrip.diffByte ?? "?" })}
        </Banner>
      )}
      {profile && !profile.editable && (
        <Banner
          tone="bad"
          title={t("banner.readOnlyTitle")}
          action={
            <Button size="sm" onClick={() => setView("settings")}>
              {t("banner.reviewDetection")}
            </Button>
          }
        >
          {t("banner.readOnlyBody")}
        </Banner>
      )}

      <div className={shared.grid2}>
        <Card title={t("overview.trainerCard")}>
          {tr ? (
            <div className={styles.trainer}>
              <Sprite name={tr.name ?? "?"} id={tr.id ?? tr.name} size={72} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className={styles.trainerName}>{tr.name ?? "—"}</div>
                <div className={shared.kv} style={{ marginTop: 8 }}>
                  <span className={shared.kvLabel}>{t("overview.money")}</span>
                  <span className={shared.kvValue}>{formatMoney(tr.money, locale)}</span>
                  {tr.available.includes("coins") && (
                    <>
                      <span className={shared.kvLabel}>{t("overview.coins")}</span>
                      <span className={shared.kvValue}>{formatNumber(tr.coins, locale)}</span>
                    </>
                  )}
                  {tr.available.includes("battle_points") && (
                    <>
                      <span className={shared.kvLabel}>{t("overview.battlePoints")}</span>
                      <span className={shared.kvValue}>{formatNumber(tr.battlePoints, locale)}</span>
                    </>
                  )}
                  <span className={shared.kvLabel}>{t("overview.playTime")}</span>
                  <span className={shared.kvValue}>{formatDuration(tr.playTime)}</span>
                  <span className={shared.kvLabel}>{t("overview.lastSaved")}</span>
                  <span className={shared.kvValue}>{formatDateTime(tr.lastSaved, locale)}</span>
                </div>
                <div className={styles.badges} aria-label={t("overview.badges")}>
                  {tr.badges.map((got, i) => (
                    <span key={i} className={got ? styles.badgeOn : styles.badgeOff} title={t("trainer.badge", { n: i + 1 })}>
                      {i + 1}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState>{t("overview.noTrainer")}</EmptyState>
          )}
        </Card>

        <Card title={t("overview.numbers")}>
          <div className={styles.numbers}>
            <Stat label={t("overview.pcPokemon")} value={formatNumber(c.boxPokemon, locale)} />
            <Stat label={t("overview.bagItems")} value={formatNumber(c.bagItems, locale)} />
            <Stat label={t("overview.pokedexSeen")} value={formatNumber(ov.pokedex?.seen, locale)} />
            <Stat label={t("overview.pokedexOwned")} value={formatNumber(ov.pokedex?.owned, locale)} />
            <Stat label={t("overview.totalPokemon")} value={formatNumber(c.pokemonTotal, locale)} />
          </div>
        </Card>
      </div>

      <Card
        title={t("overview.partyCard")}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setView("party")}>
            {t("nav.party")} →
          </Button>
        }
      >
        {ov.party.length === 0 ? (
          <EmptyState>{t("overview.noParty")}</EmptyState>
        ) : (
          <div className={styles.partyStrip}>
            {ov.party.map((p) => (
              <button key={p.ref} type="button" className={styles.partyMini} onClick={() => openEditor(p.ref)}>
                <PokemonIcon name={displayName(p)} species={p.species?.id ?? 0} form={p.form} gender={p.gender} shiny={p.shiny} egg={p.egg} size={52} />
                <span className={styles.miniName}>{p.egg ? t("party.egg") : displayName(p)}</span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {p.level != null ? t("party.level", { level: p.level }) : ""} {genderSymbol(p.gender)}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <LegalityCard />

      <div className={shared.grid2}>
        {profile && <ProfileCard profile={profile} compact />}
        <Card title={t("overview.coverage")}>
          {cov.data ? (
            <div className={shared.stack} style={{ gap: 12 }}>
              <CoverageMeter buckets={cov.data.buckets} total={cov.data.total} />
              <span className="muted">{t("overview.coverageHint")}</span>
              <div>
                <Button size="sm" onClick={() => setView("unclassified")}>
                  {t("overview.openUnclassified")}
                </Button>{" "}
                <Chip>{t("unclassified.ofTotal", { count: cov.data.total - cov.data.buckets.unclassified, total: cov.data.total })}</Chip>
              </div>
            </div>
          ) : (
            <PokeballSpinner size={28} />
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statValue}>{value}</div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
    </div>
  );
}
