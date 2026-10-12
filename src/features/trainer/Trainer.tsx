import { User } from "lucide-react";
import { semantic } from "../../api/semantic";
import { useT } from "../../lib/useT";
import { useEdit } from "../../stores/edit";
import { useSession } from "../../stores/session";
import { Card, EmptyState, Field, NumberField, PageTitle, PokeballSpinner, SelectField, Switch, TextField } from "../../ui";
import { ExtrasList } from "../shared/ExtrasList";
import shared from "../shared/shared.module.css";
import { useSemanticQuery } from "../queries";
import overview from "../overview/overview.module.css";

export function Trainer() {
  const { t } = useT();
  const apply = useEdit((s) => s.apply);
  const profile = useSession((s) => s.profile);
  const q = useSemanticQuery("trainer", semantic.trainer);

  if (q.isPending) return <PokeballSpinner />;
  const tr = q.data;
  if (!tr) return <EmptyState>{t("overview.noTrainer")}</EmptyState>;

  const editable = profile?.editable ?? false;
  const has = (f: string) => tr.available.includes(f);
  const set = (field: string, value: string | number | null) => void apply([{ op: "set", ref: "trainer", field, value }]);
  const num = (field: string, label: string, max?: number) => (
    <Field label={label} hint={has(field) ? undefined : t("trainer.missing")}>
      {(id) => (
        <NumberField
          id={id}
          value={(tr as unknown as Record<string, number | null>)[field === "battle_points" ? "battlePoints" : field]}
          min={0}
          max={max}
          disabled={!editable || !has(field)}
          onCommit={(n) => set(field, n)}
        />
      )}
    </Field>
  );

  return (
    <div className={shared.stack}>
      <PageTitle icon={<User />} title={t("trainer.title")} />
      <Card>
        <div className={shared.formGrid}>
          <Field label={t("trainer.name")}>
            {(id) => <TextField id={id} value={tr.name} disabled={!editable || !has("name")} onCommit={(v) => set("name", v ?? "")} />}
          </Field>
          <Field label={t("trainer.id")} hint={t("trainer.readOnlyId")}>
            {(id) => <NumberField id={id} value={tr.id} disabled onCommit={() => undefined} />}
          </Field>
          {has("gender") && (
            <Field label={t("trainer.gender")}>
              {(id) => (
                <SelectField
                  id={id}
                  value={tr.gender}
                  disabled={!editable}
                  options={[0, 1, 2].map((g) => ({ value: g, label: t(`gender.${g}` as never) as string }))}
                  onChange={(g) => set("gender", g)}
                />
              )}
            </Field>
          )}
          {num("money", t("trainer.money"), tr.limits.maxMoney)}
          {has("coins") && num("coins", t("trainer.coins"), tr.limits.maxCoins)}
          {has("battle_points") && num("battle_points", t("trainer.battlePoints"), tr.limits.maxBattlePoints)}
          {has("soot") && num("soot", t("trainer.soot"), tr.limits.maxSoot)}
        </div>
      </Card>

      <Card title={t("trainer.badges")}>
        <div className={overview.badges} style={{ marginTop: 0, gap: 12 }}>
          {tr.badges.map((got, i) => (
            <label key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <span className={got ? overview.badgeOn : overview.badgeOff} style={{ width: 40, height: 40, fontSize: 15 }}>
                {i + 1}
              </span>
              <Switch
                checked={got}
                disabled={!editable}
                label={t("trainer.badge", { n: i + 1 })}
                onChange={(v) => void apply([{ op: "trainer.badge", index: i, value: v }])}
              />
            </label>
          ))}
        </div>
      </Card>

      {tr.extras.length > 0 && (
        <Card title={t("trainer.extras")}>
          <ExtrasList ref_="trainer" extras={tr.extras} readOnly={!editable} />
        </Card>
      )}
    </div>
  );
}
