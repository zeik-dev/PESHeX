import { useEffect, useMemo, useState } from "react";
import { bytesUrl, directUrl, isProtocolBroken, markProtocolBroken } from "../game/assetUrl";
import {
  resolveBallIcon, resolveHeldItemIcon, resolveItemIcon, type ItemKey,
} from "../game/resolve/item";
import { resolvePokemonIcon, type PokemonKey } from "../game/resolve/pokemon";
import type { IconResolved, Resolved } from "../game/resolve/common";
import { useGame } from "../stores/game";
import styles from "./ui.module.css";
import { cx } from "./cx";
import { Sprite } from "./visual";

interface GameImageProps {
  rel: string;
  /** Alto en px de UN cuadro. */
  size: number;
  /** Cuadros en horizontal en la imagen (tira de iconos); solo se muestra el primero. */
  frames?: number;
  /** ancho/alto de un cuadro. */
  frameRatio?: number;
  alt?: string;
  className?: string;
  onFailed?: () => void;
}

/** Imagen de la carpeta del juego: asset protocol y, si falla, bytes por IPC. */
export function GameImage({ rel, size, frames = 1, frameRatio = 1, alt = "", className, onFailed }: GameImageProps) {
  const root = useGame((s) => s.status.root);
  const [src, setSrc] = useState<string | null>(() => (root && !isProtocolBroken() ? directUrl(root, rel) : null));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!root) return;
    if (!isProtocolBroken()) {
      setSrc(directUrl(root, rel));
      return;
    }
    let live = true;
    setSrc(null);
    bytesUrl(rel).then((u) => live && setSrc(u), () => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [root, rel]);

  useEffect(() => {
    if (failed) onFailed?.();
  }, [failed, onFailed]);

  if (failed || !src) return null;
  const w = Math.round(size * frameRatio);
  return (
    <span className={cx(styles.gameImg, className)} style={{ width: w, height: size }} aria-hidden={alt ? undefined : true}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{ height: size, width: Math.round(w * frames) }}
        onError={() => {
          // Si ya era un blob (plan B) y tambien falla, no hay mas que intentar.
          if (src.startsWith("blob:")) {
            setFailed(true);
            return;
          }
          markProtocolBroken(); // las siguientes imagenes van directas por bytes
          bytesUrl(rel).then(setSrc, () => setFailed(true));
        }}
      />
    </span>
  );
}

function iconProps(r: IconResolved) {
  return { rel: r.path, frames: r.frames, frameRatio: r.frameH > 0 ? r.frameW / r.frameH : 1 };
}

/** Icono de un Pokemon con los graficos del juego; sin ellos, el marcador de color. */
export function PokemonIcon({
  species, form, gender, shiny, shadow, egg, number, name, size = 48, className,
}: PokemonKey & { name: string; size?: number; className?: string }) {
  const ctx = useGame((s) => s.ctx);
  const resolved = useMemo(
    () => (ctx && species != null ? resolvePokemonIcon(ctx, { species, form, gender, shiny, shadow, egg, number }) : null),
    [ctx, species, form, gender, shiny, shadow, egg, number],
  );
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [resolved?.path]);
  if (!resolved || broken) {
    return <Sprite name={name} id={species as string | number | undefined} size={size} shiny={shiny} egg={egg} />;
  }
  return (
    <GameImage {...iconProps(resolved)} size={size} alt={name} className={className} onFailed={() => setBroken(true)} />
  );
}

/** Icono de objeto; sin imagen devuelve null (el llamador decide el marcador). */
export function ItemIcon({ item, size = 24, className }: { item: ItemKey; size?: number; className?: string }) {
  const ctx = useGame((s) => s.ctx);
  const catalog = useGame((s) => s.catalogIndex);
  const resolved = useMemo<Resolved | null>(() => {
    if (!ctx) return null;
    const cat = typeof item.id === "number" ? catalog?.itemsByNumber.get(item.id) : catalog?.items.get(item.id);
    const moveType = cat?.move ? catalog?.moves.get(cat.move)?.type ?? null : null;
    return resolveItemIcon(ctx, {
      ...item,
      number: item.number ?? cat?.number,
      machineType: item.machineType ?? moveType,
      fieldUse: item.fieldUse ?? cat?.fieldUse,
    });
  }, [ctx, catalog, item]);
  if (!resolved) return null;
  return <GameImage rel={resolved.path} size={size} className={className} />;
}

/** `ball` es el id del OBJETO-bola ("GREATBALL"; el driver ya lo resuelve en bases antiguas con `ballItem`). */
export function BallIcon({ ball, size = 24, className }: { ball: string | number; size?: number; className?: string }) {
  const ctx = useGame((s) => s.ctx);
  const catalog = useGame((s) => s.catalogIndex);
  const resolved = useMemo(() => {
    if (!ctx) return null;
    const number = typeof ball === "string" ? catalog?.items.get(ball)?.number : null;
    return resolveBallIcon(ctx, ball, number);
  }, [ctx, ball, catalog]);
  if (!resolved) return null;
  return <GameImage rel={resolved.path} size={size} className={className} />;
}

/** Marca de "lleva objeto" de las pantallas del juego. */
export function HeldItemMark({ size = 16 }: { size?: number }) {
  const ctx = useGame((s) => s.ctx);
  const resolved = useMemo(() => (ctx ? resolveHeldItemIcon(ctx) : null), [ctx]);
  if (!resolved) return null;
  return <GameImage rel={resolved.path} size={size} />;
}
