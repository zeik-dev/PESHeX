import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT } from "../../lib/useT";
import { AppLogo, Button, Card } from "../../ui";
import shared from "../shared/shared.module.css";

const REPO_URL = "https://github.com/zeik-dev/PESHeX";
const RELEASES_URL = `${REPO_URL}/releases`;

function LinkButton({ url, children }: { url: string; children: string }) {
  return (
    <Button size="sm" variant="ghost" onClick={() => void openUrl(url).catch(() => undefined)} title={url}>
      {children} <ExternalLink size={13} aria-hidden="true" />
    </Button>
  );
}

/** «Acerca de»: version, autor, licencia y enlaces del proyecto (no depende de ninguna partida). */
export function AboutCard() {
  const { t } = useT();
  return (
    <Card title={t("settings.about")}>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <AppLogo size={48} />
        <div>
          <strong>{t("app.name")}</strong> <span className="muted mono">{t("settings.version", { version: __APP_VERSION__ })}</span> — {t("app.tagline")}
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>{t("app.disclaimer")}</p>
        </div>
      </div>
      <dl className={shared.kv} style={{ marginTop: 14 }} data-testid="about-details">
        <dt className={shared.kvLabel}>{t("settings.aboutAuthor")}</dt>
        <dd className={shared.kvValue} style={{ margin: 0 }}>Randy A. Germosén (zeik-dev)</dd>
        <dt className={shared.kvLabel}>{t("settings.aboutLicense")}</dt>
        <dd className={shared.kvValue} style={{ margin: 0 }}>MIT</dd>
        <dt className={shared.kvLabel}>{t("settings.aboutLinks")}</dt>
        <dd className={shared.kvValue} style={{ margin: 0, display: "flex", gap: 4, flexWrap: "wrap" }}>
          <LinkButton url={REPO_URL}>{t("settings.aboutRepo")}</LinkButton>
          <LinkButton url={RELEASES_URL}>{t("settings.aboutReleases")}</LinkButton>
        </dd>
      </dl>
    </Card>
  );
}
