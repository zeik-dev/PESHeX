import { Users } from "lucide-react";
import { semantic } from "../../api/semantic";
import { useT } from "../../lib/useT";
import { displayName, genderSymbol } from "../../lib/pokemon";
import type { PokemonSummary } from "../../api/types";
import { useSession } from "../../stores/session";
import { Chip, EmptyState, HpBar, PageTitle, PokeballSpinner, PokemonIcon } from "../../ui";
import { useSemanticQuery } from "../queries";
import styles from "./party.module.css";

export function PokemonCard({ p, onOpen }: { p: PokemonSummary; onOpen: (ref: string) => void }) {
  const { t, dynOr } = useT();
  return (
    <button type="button" className={styles.card} onClick={() => onOpen(p.ref)} aria-label={displayName(p)}>
      <PokemonIcon name={displayName(p)} species={p.species?.id ?? 0} form={p.form} gender={p.gender} shiny={p.shiny} egg={p.egg} size={64} />
      <div className={styles.body}>
        <div className={styles.name}>
          {p.egg ? t("party.egg") : displayName(p)} <span className={styles.gender}>{genderSymbol(p.gender)}</span>
        </div>
        {p.nickname && p.species && !p.egg && <div className="muted" style={{ fontSize: 12 }}>{p.species.name}</div>}
        <div className={styles.meta}>
          {p.level != null && <Chip tone="accent">{t("party.level", { level: p.level })}</Chip>}
          {p.shiny && <Chip tone="warn">★ {t("party.shiny")}</Chip>}
          {p.status != null && p.status !== "NONE" && <Chip tone="bad">{dynOr("status", p.status, String(p.status))}</Chip>}
          <Chip>{p.item ? p.item.name : t("party.noItem")}</Chip>
        </div>
        <div className={styles.hp}>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("party.hp")} {p.hp ?? "?"}/{p.totalHp ?? "?"}
          </span>
          <HpBar hp={p.hp} total={p.totalHp} />
        </div>
      </div>
    </button>
  );
}

export function Party() {
  const { t } = useT();
  const openEditor = useSession((s) => s.openEditor);
  const q = useSemanticQuery("party", semantic.party);

  if (q.isPending) return <PokeballSpinner />;
  const party = q.data ?? [];

  return (
    <div>
      <PageTitle icon={<Users />} title={t("party.title")} />
      {party.length === 0 ? (
        <EmptyState>{t("party.empty")}</EmptyState>
      ) : (
        <div className={styles.grid}>
          {party.map((p) => (
            <PokemonCard key={p.ref} p={p} onOpen={openEditor} />
          ))}
        </div>
      )}
    </div>
  );
}
