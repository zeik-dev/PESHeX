import { useT } from "../../lib/useT";
import { Card } from "../../ui";
import { GameLibrary } from "../games/GameLibrary";

/** «Mis juegos» en Ajustes: registrar, quitar y gestionar las carpetas de guardado (abrir partidas se hace desde el inicio). */
export function GamesCard() {
  const { t } = useT();
  return (
    <Card title={t("games.title")}>
      <p className="muted" style={{ marginTop: 0 }}>{t("games.manage")}</p>
      <GameLibrary variant="manage" />
    </Card>
  );
}
