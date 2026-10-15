import { useEffect, useState } from "react";
import { semantic } from "../../api/semantic";
import type { PokemonDetail } from "../../api/types";
import { useT } from "../../lib/useT";
import { useGame } from "../../stores/game";
import { useSession } from "../../stores/session";
import { useHexMode } from "../../stores/settings";
import { Banner, Chip, Drawer, EmptyState, PokeballSpinner, Tabs } from "../../ui";
import { FlagList } from "../legality/FlagList";
import { LegalityBadge } from "../legality/LegalityBadge";
import { ExtrasList } from "../shared/ExtrasList";
import { GeneralTab } from "./GeneralTab";
import { MovesTab } from "./MovesTab";
import { QuickActions } from "./QuickActions";
import { SpeciesCard } from "./SpeciesCard";
import { StatsTab } from "./StatsTab";
import { useSpeciesDetail } from "./useSpeciesDetail";
import shared from "../shared/shared.module.css";
import { useSemanticQuery } from "../queries";
import styles from "./pokemon.module.css";

type Tab = "general" | "stats" | "moves" | "legality" | "info";

/** Hoja lateral ANCHA (algo más de la mitad de la pantalla) con el editor del Pokémon seleccionado (equipo o PC). */
export function PokemonEditorHost() {
  const { t } = useT();
  const ref = useSession((s) => s.editorRef);
  const close = useSession((s) => s.closeEditor);
  return (
    <Drawer open={!!ref} title={t("nav.party")} onClose={close} wide>
      {ref && <PokemonEditor key={ref} ref_={ref} />}
    </Drawer>
  );
}

function PokemonEditor({ ref_ }: { ref_: string }) {
  const { t } = useT();
  const hex = useHexMode();
  const profile = useSession((s) => s.profile);
  const q = useSemanticQuery(["pokemon", ref_], () => semantic.pokemon(ref_));
  const [tab, setTab] = useState<Tab>("general");
  const species = useSpeciesDetail(q.data ?? { species: null, form: null });

  // La pestaña «Legalidad» solo existe en HeX: si se pasa a HaX con ella abierta, se vuelve a General.
  useEffect(() => {
    if (!hex && tab === "legality") setTab("general");
  }, [hex, tab]);

  if (q.isError) return <EmptyState>{String((q.error as { message?: string })?.message ?? "")}</EmptyState>;
  if (!q.data) return <div style={{ padding: 24 }}><PokeballSpinner /></div>;
  const pk = q.data;
  const editable = profile?.editable ?? false;

  return (
    <div>
      <SpeciesCard pk={pk} species={species} />

      <div className={styles.body}>
        {pk.shared.length > 0 && (
          <Banner tone="info" title={t("banner.sharedTitle")}>
            {t("banner.sharedBody", { paths: pk.shared.join(", ") })}
          </Banner>
        )}
        <QuickActions pk={pk} editable={editable} hideEv={tab === "stats"} />
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "general", label: t("pokemon.tabs.general") },
            { id: "stats", label: t("pokemon.tabs.stats") },
            { id: "moves", label: t("pokemon.tabs.moves"), badge: pk.moves.filter((m) => !m.empty).length },
            ...(hex ? [{ id: "legality" as const, label: t("legality.tab"), badge: pk.flags.filter((f) => f.severity !== "info").length || undefined }] : []),
            { id: "info", label: t("pokemon.tabs.info") },
          ]}
        />
        {tab === "general" && <GeneralTab pk={pk} editable={editable} species={species} />}
        {tab === "stats" && <StatsTab pk={pk} editable={editable} species={species} />}
        {tab === "moves" && <MovesTab pk={pk} editable={editable} species={species} />}
        {tab === "legality" && hex && (
          <div className={shared.stack}>
            <LegalityBadge flags={pk.flags} />
            {pk.flags.length > 0 && <FlagList flags={pk.flags} />}
          </div>
        )}
        {tab === "info" && <Info pk={pk} editable={editable} />}
      </div>
    </div>
  );
}

function Info({ pk, editable }: { pk: PokemonDetail; editable: boolean }) {
  const { t } = useT();
  const ribbonInfo = useGame((s) => s.catalog?.ribbons);
  const vanilla = pk.extras.filter((e) => !e.custom);
  const custom = pk.extras.filter((e) => e.custom);
  return (
    <div className={shared.stack}>
      <div className={shared.kv}>
        <span className={shared.kvLabel}>{t("pokemon.info.owner")}</span>
        <span className={shared.kvValue}>{pk.owner?.name ?? "—"}{pk.owner?.id != null ? ` (${pk.owner.id})` : ""}</span>
        <span className={shared.kvLabel}>{t("pokemon.info.personalId")}</span>
        <span className={shared.kvValue}>{pk.personalId ?? "—"}</span>
        {pk.ribbons != null && (
          <>
            <span className={shared.kvLabel}>{t("pokemon.info.ribbons")}</span>
            <span className={shared.kvValue} data-testid="pokemon-ribbons">
              {pk.ribbons.length === 0 ? "—" : (
                <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                  {pk.ribbons.map((r) => (
                    <Chip key={String(r.id)} tone="info" title={ribbonInfo?.find((x) => x.id === String(r.id))?.description ?? undefined}>
                      {r.name ?? String(r.id)}
                    </Chip>
                  ))}
                </span>
              )}
            </span>
          </>
        )}
        <span className={shared.kvLabel}>{t("pokemon.info.path")}</span>
        <span className={shared.kvValue + " mono"}>{pk.fieldPath}</span>
      </div>
      {custom.length > 0 && (
        <div>
          <div className={styles.sectionLabel}>{t("pokemon.info.customs")}</div>
          <ExtrasList ref_={pk.ref} extras={custom} readOnly={!editable} />
        </div>
      )}
      {vanilla.length > 0 && (
        <div>
          <div className={styles.sectionLabel}>{t("pokemon.info.others")}</div>
          <ExtrasList ref_={pk.ref} extras={vanilla} readOnly={!editable} />
        </div>
      )}
    </div>
  );
}
