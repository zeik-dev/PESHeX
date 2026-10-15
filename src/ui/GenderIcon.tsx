import { CircleSlash, Mars, Venus } from "lucide-react";
import { useT } from "../lib/useT";
import styles from "./ui.module.css";

/** Icono de género (0 macho, 1 hembra, 2 sin género). Propio, siempre disponible: no depende de la carpeta del juego. */
export function GenderIcon({ gender, size = 16 }: { gender: number | null | undefined; size?: number }) {
  const { t } = useT();
  if (gender !== 0 && gender !== 1 && gender !== 2) return null;
  const label = t(`gender.${gender}` as never) as string;
  const Icon = gender === 0 ? Mars : gender === 1 ? Venus : CircleSlash;
  return (
    <span className={styles.genderIcon} data-gender={gender} role="img" aria-label={label} title={label}>
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}
