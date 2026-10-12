import { Check } from "lucide-react";
import type { Flag } from "../../api/types";
import { worstSeverity } from "../../lib/legality";
import { useT } from "../../lib/useT";
import { Chip } from "../../ui";
import { SeverityIcon } from "./FlagList";
import styles from "./legality.module.css";

/** Insignia de legalidad de una entidad: ✓ legal, ⚠ avisos, ✗ ilegal (icono + texto, nunca solo color). */
export function LegalityBadge({ flags, partial }: { flags: Flag[]; partial?: boolean }) {
  const { t } = useT();
  const visible = flags.filter((f) => f.severity !== "info");
  const worst = worstSeverity(visible);
  const illegal = visible.filter((f) => f.severity === "illegal").length;
  const warning = visible.length - illegal;
  if (!worst) {
    return (
      <Chip tone={partial ? "info" : "good"} title={partial ? t("legality.partialBanner") : undefined}>
        <Check size={13} /> {t("legality.pokemonOk")}
      </Chip>
    );
  }
  return (
    <span className={styles.counts}>
      {illegal > 0 && (
        <Chip tone="bad">
          <SeverityIcon severity="illegal" size={13} /> {t("legality.illegal", { count: illegal })}
        </Chip>
      )}
      {warning > 0 && (
        <Chip tone="warn">
          <SeverityIcon severity="warning" size={13} /> {t("legality.warning", { count: warning })}
        </Chip>
      )}
    </span>
  );
}
