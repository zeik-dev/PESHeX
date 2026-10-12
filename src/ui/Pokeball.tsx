import { useTranslation } from "react-i18next";
import styles from "./ui.module.css";
import { cx } from "./cx";

/** Poké Ball dibujada por nosotros (SVG propio, sin atribuciones). El color de
 *  la mitad superior sale de --pb-top, asi respeta los "ball themes". */
export function PokeballIcon({ size = 24, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={cx(styles.pokeball, className)}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle cx="50" cy="50" r="46" fill="var(--pb-white)" stroke="var(--pb-ink)" strokeWidth="6" />
      <path d="M4 50a46 46 0 0 1 92 0z" fill="var(--pb-top)" stroke="var(--pb-ink)" strokeWidth="6" strokeLinejoin="round" />
      <path d="M4 50h92" stroke="var(--pb-ink)" strokeWidth="8" />
      <circle cx="50" cy="50" r="15" fill="var(--pb-white)" stroke="var(--pb-ink)" strokeWidth="7" />
      <circle cx="50" cy="50" r="6" fill="var(--pb-grey)" stroke="var(--pb-ink)" strokeWidth="2" />
    </svg>
  );
}

/** Logo de PESHeX (branding/PESHeX.png, recortado a public/logo-256.png). Es pixel
 *  art: se escala sin suavizado. Decorativo salvo que se pase `title`. */
export function AppLogo({ size = 32, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <img
      className={cx(styles.logo, className)}
      src="/logo-256.png"
      width={size}
      height={size}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      draggable={false}
    />
  );
}

/** Indicador de carga: una Poké Ball que se sacude (estatica con reduced-motion). */
export function PokeballSpinner({ label, size = 40 }: { label?: string; size?: number }) {
  const { t } = useTranslation();
  return (
    <div className={styles.spinnerWrap} role="status" aria-live="polite">
      <PokeballIcon size={size} className={styles.spinner} />
      <span>{label ?? t("common.loading")}</span>
    </div>
  );
}
