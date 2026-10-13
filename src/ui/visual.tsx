import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./ui.module.css";
import { cx } from "./cx";
import { hueFromString } from "../lib/format";
import type { Bucket } from "../api/types";

/** Marcador de posicion del sprite de un Pokemon/objeto: circulo de color
 *  estable por especie con su inicial. (Con la carpeta del juego se cambiara
 *  por la imagen real: `src`.) */
export function Sprite({
  name,
  id,
  size = 56,
  shiny,
  egg,
  src,
}: {
  name: string;
  id?: string | number | null;
  size?: number;
  shiny?: boolean;
  egg?: boolean;
  src?: string | null;
}) {
  if (src) {
    return <img src={src} width={size} height={size} alt={name} className={styles.spriteImg} />;
  }
  const hue = hueFromString(String(id ?? name));
  const letter = egg ? "?" : (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className={cx(styles.sprite, shiny && styles.spriteShiny)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: egg ? "var(--surface-3)" : `hsl(${hue} 55% 38%)`,
        color: egg ? "var(--text-muted)" : "#fff",
      }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

/** Barra con valor visible. `over` pinta en aviso cuando se pasa del maximo. */
export function StatBar({ value, max, label }: { value: number | null | undefined; max: number; label?: string }) {
  const v = value ?? 0;
  const pct = Math.min(100, Math.max(0, (v / max) * 100));
  return (
    <div className={styles.bar} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={v} aria-label={label}>
      <div className={cx(styles.barFill, v > max && styles.barOver)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function HpBar({ hp, total }: { hp: number | null; total: number | null }) {
  if (hp == null || !total) return null;
  const pct = Math.min(100, (hp / total) * 100);
  const color = pct > 50 ? "var(--success)" : pct > 20 ? "var(--warning)" : "var(--danger)";
  return (
    <div className={styles.bar} aria-hidden="true">
      <div className={styles.barFill} style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function PageTitle({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  return (
    <>
      <h1 className={styles.pageTitle}>
        {icon}
        {title}
      </h1>
      {subtitle && <p className={styles.pageSubtitle}>{subtitle}</p>}
    </>
  );
}

export interface CardCollapse {
  open: boolean;
  onToggle: () => void;
  /** Texto accesible/visible del boton segun el estado ("Mostrar" / "Ocultar"). */
  toggleLabel: string;
  /** Se muestra en la cabecera cuando esta plegada (p. ej. un resumen en chips). */
  summary?: ReactNode;
}

/** `collapse` hace la tarjeta desplegable (patron acordeon: el titulo es un boton con `aria-expanded`). */
export function Card({
  title,
  icon,
  actions,
  children,
  className,
  collapse,
}: {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  collapse?: CardCollapse;
}) {
  const contentId = useId();
  const open = collapse ? collapse.open : true;
  return (
    <section className={cx(styles.card, className)}>
      {(title || actions) && (
        <h2 className={cx(styles.cardTitle, collapse && !open && styles.cardTitleClosed)}>
          {icon}
          {collapse ? (
            <button
              type="button"
              className={styles.cardToggle}
              aria-expanded={open}
              aria-controls={contentId}
              title={collapse.toggleLabel}
              onClick={collapse.onToggle}
            >
              {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
              <span>{title}</span>
            </button>
          ) : (
            <span style={{ flex: 1 }}>{title}</span>
          )}
          {collapse && !open && collapse.summary}
          {collapse && <span style={{ flex: 1 }} />}
          {actions}
        </h2>
      )}
      {collapse ? (
        <div id={contentId} hidden={!open}>
          {open && children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

const BUCKET_COLORS: Record<Bucket, string> = {
  classified: "var(--success)",
  custom: "var(--info)",
  world: "var(--text-muted)",
  unclassified: "var(--warning)",
};

export function bucketColor(b: Bucket): string {
  return BUCKET_COLORS[b];
}

/** Anillo tipo Poké Ball que muestra cuanto del save esta clasificado. */
export function CoverageMeter({ buckets, total }: { buckets: Record<Bucket, number>; total: number }) {
  const { t, i18n } = useTranslation();
  const size = 120;
  const r = 46;
  const c = 2 * Math.PI * r;
  const order: Bucket[] = ["classified", "custom", "world", "unclassified"];
  let offset = 0;
  const known = total - buckets.unclassified;
  const pct = total ? Math.round((known / total) * 100) : 100;
  return (
    <div className={styles.coverage}>
      <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`${t("unclassified.coverage")}: ${pct}%`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="14" />
        {order.map((b) => {
          const len = total ? (buckets[b] / total) * c : 0;
          const el = (
            <circle
              key={b}
              cx="60"
              cy="60"
              r={r}
              fill="none"
              stroke={BUCKET_COLORS[b]}
              strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 60 60)"
            />
          );
          offset += len;
          return el;
        })}
        <circle cx="60" cy="60" r="30" fill="var(--surface)" stroke="var(--pb-ink)" strokeWidth="4" />
        <text x="60" y="66" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text)">
          {pct}%
        </text>
      </svg>
      <div className={styles.coverageLegend}>
        {order.map((b) => (
          <div key={b} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: BUCKET_COLORS[b] }} />
            <span>
              <strong>{t(`unclassified.bucket.${b}` as never) as string}</strong>{" "}
              <span className="muted">{buckets[b].toLocaleString(i18n.language)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
