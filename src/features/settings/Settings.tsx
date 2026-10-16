import { Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { semantic } from "../../api/semantic";
import { useT } from "../../lib/useT";
import { useSession, toastError } from "../../stores/session";
import { Button, Card, Field, PageTitle, SelectField } from "../../ui";
import { ProfileCard } from "../shared/ProfileCard";
import { ModeSwitch } from "../../app/ModeSwitch";
import { AboutCard } from "./AboutCard";
import { AssetsCard } from "./AssetsCard";
import { GeneralCard } from "./GeneralCard";
import { GameFolderCard } from "./GameFolderCard";
import { GamesCard } from "./GamesCard";
import { UpdatesCard } from "../updater/UpdatesCard";
import { ZoomCard } from "./ZoomCard";
import shared from "../shared/shared.module.css";

const PROFILE_IDS = ["essentials_savedata", "essentials_legacy", "generic"] as const;

export function Settings() {
  const { t, dyn } = useT();
  const profile = useSession((x) => x.profile);
  const setProfile = useSession((x) => x.setProfile);
  const pending = useSession((x) => x.pendingCount);
  const [chosen, setChosen] = useState<string | null>(null);

  async function confirmProfile() {
    const id = chosen ?? profile?.id ?? null;
    try {
      setProfile(await semantic.setProfileOverride(id));
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div className={shared.stack}>
      <PageTitle icon={<SettingsIcon />} title={t("settings.title")} />

      <GeneralCard />

      <ZoomCard />

      <Card title={t("mode.title")}>
        <div className={shared.stack}>
          <ModeSwitch large />
          <p><strong>{t("mode.hexTitle")}</strong> — {t("mode.hexBody")}</p>
          <p><strong>{t("mode.haxTitle")}</strong> — {t("mode.haxBody")}</p>
        </div>
      </Card>

      <Card title={t("shortcuts.title")}>
        <dl className={shared.kv}>
          {([
            ["Ctrl + K", t("shortcuts.palette")],
            ["Ctrl + S", t("shortcuts.save")],
            ["Ctrl + Z", t("shortcuts.undoKeys")],
            [t("shortcuts.redoCombo"), t("shortcuts.redoKeys")],
          ] as const).map(([keys, what]) => (
            <div key={keys} style={{ display: "contents" }}>
              <dt className={shared.kvLabel}><kbd className="mono">{keys}</kbd></dt>
              <dd className={shared.kvValue} style={{ margin: 0 }}>{what}</dd>
            </div>
          ))}
        </dl>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{t("shortcuts.hint")}</p>
      </Card>

      <Card title={t("settings.detection")}>
        {profile ? (
          <div className={shared.stack}>
            <p className="muted">{t("profile.wizardBody")}</p>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label={t("profile.wizardTitle")}>
                {(id) => (
                  <SelectField id={id} value={chosen ?? profile.id} onChange={setChosen}
                    options={PROFILE_IDS.map((p) => ({ value: p as string, label: dyn(`profile.id.${p}`) }))} />
                )}
              </Field>
              <Button variant="primary" disabled={pending > 0} onClick={() => void confirmProfile()}>
                {t("profile.confirmProfile")}
              </Button>
            </div>
            <ProfileCard profile={profile} />
          </div>
        ) : (
          <span className="muted">{t("settings.noFile")}</span>
        )}
      </Card>

      <GameFolderCard />
      <GamesCard />
      <UpdatesCard />
      <AssetsCard />

      <AboutCard />
    </div>
  );
}
