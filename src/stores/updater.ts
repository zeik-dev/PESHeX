import { create } from "zustand";
import { onUpdaterEvent, updaterApi, type ReleaseInfo, type UpdateResult, type UpdaterEvent } from "../api/updater";
import { toApiError } from "../api/tauri";
import i18n from "../i18n";
import { useSession } from "./session";
import { useSettings } from "./settings";
import { useToasts } from "./toasts";

/** Fases visibles de una actualizacion. `available` = hay una version nueva y aun no se descarga. */
export type UpdatePhase = "idle" | "checking" | "available" | "downloading" | "paused" | "verifying" | "extracting" | "ready" | "applying" | "failed";

export interface UpdateProgress {
  downloaded: number;
  total: number;
  bytesPerSec: number;
}

export interface UpdateFailure {
  code: string;
  message: string;
}

/** Resultado de la ultima busqueda (para la tarjeta de Ajustes). */
export type LastCheck = { status: "upToDate"; version: string } | { status: "error"; code: string; message: string } | null;

interface UpdaterState {
  /** Hay actualizador junto a la app (solo en la version instalada de Windows). Hasta saberlo, `null`. */
  supported: boolean | null;
  phase: UpdatePhase;
  release: ReleaseInfo | null;
  progress: UpdateProgress;
  error: UpdateFailure | null;
  dialogOpen: boolean;
  /** Se pidio instalar con cambios sin guardar: se pregunta antes. */
  confirmUnsaved: boolean;
  lastCheck: LastCheck;
  init: () => Promise<void>;
  /** `manual`: lo pidio el usuario (siempre abre el dialogo si hay version nueva, aunque la haya omitido). */
  check: (manual: boolean) => Promise<void>;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Instala y reinicia. Con cambios sin guardar pide confirmacion salvo `force`. */
  apply: (force?: boolean) => Promise<void>;
  dismissUnsaved: () => void;
  openDialog: () => void;
  /** «Recordármelo luego» / ocultar: una descarga en curso sigue en segundo plano. */
  hideDialog: () => void;
  skip: () => void;
  /** Acepta el fallo mostrado y vuelve a ofrecer la descarga. */
  clearFailure: () => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_PROGRESS: UpdateProgress = { downloaded: 0, total: 0, bytesPerSec: 0 };
/** Fases en las que el actualizador esta trabajando (no se puede lanzar otra busqueda ni descarga). */
const BUSY: UpdatePhase[] = ["checking", "downloading", "paused", "verifying", "extracting", "ready", "applying"];

export const isBusy = (p: UpdatePhase) => BUSY.includes(p);

function failureOf(e: unknown): UpdateFailure {
  const err = toApiError(e);
  return { code: err.kind === "default" ? "updater_failed" : err.kind, message: err.message };
}

let started = false;

export const useUpdater = create<UpdaterState>((set, get) => {
  /** Mensajes del actualizador. */
  function onEvent(ev: UpdaterEvent) {
    const s = get();
    switch (ev.event) {
      case "state": {
        if (ev.state === "cancelled") return set({ phase: s.release ? "available" : "idle", progress: NO_PROGRESS });
        return set({ phase: ev.state });
      }
      case "progress":
        return set({ progress: { downloaded: ev.downloaded, total: ev.total, bytesPerSec: ev.bytesPerSec } });
      case "error":
        return set({ phase: "failed", error: { code: ev.code, message: ev.message }, dialogOpen: true });
      case "exited":
        // Termino sin avisar de un error ni de que estaba listo: se cerro por su cuenta.
        if (isBusy(s.phase) && s.phase !== "checking") {
          set({ phase: "failed", error: { code: "updater_failed", message: `exit ${ev.code ?? "?"}` }, dialogOpen: true });
        }
        return;
      default:
        return;
    }
  }

  return {
    supported: null,
    phase: "idle",
    release: null,
    progress: NO_PROGRESS,
    error: null,
    dialogOpen: false,
    confirmUnsaved: false,
    lastCheck: null,

    async init() {
      if (started) return;
      started = true;
      const supported = await updaterApi.available().catch(() => false);
      set({ supported: !!supported });
      if (!supported) return;
      await onUpdaterEvent(onEvent);
      // Si la app se abrio justo despues de un reemplazo, se cuenta como fue.
      const res: UpdateResult | null = await updaterApi.lastResult().catch(() => null);
      if (res) {
        const t = i18n.t.bind(i18n);
        useToasts.getState().push(
          res.ok
            ? { kind: "success", text: t("updater.result.ok", { version: res.version }) }
            : { kind: "error", text: t("updater.result.failed", { version: res.version, message: res.message ?? res.code ?? "" }) },
        );
      }
      const st = useSettings.getState();
      if (st.updateCheckOnStart && Date.now() - st.updateLastCheck > DAY_MS) {
        // Un poco despues de arrancar, para no competir con la carga de la partida.
        setTimeout(() => void get().check(false), 4000);
      }
    },

    async check(manual) {
      if (get().supported === false) return;
      if (isBusy(get().phase)) return;
      const prev = get().phase;
      set({ phase: "checking", lastCheck: manual ? null : get().lastCheck });
      let res;
      try {
        res = await updaterApi.check();
      } catch (e) {
        res = { status: "error" as const, ...failureOf(e) };
      }
      if (res.status === "unavailable") return set({ supported: false, phase: "idle" });
      useSettings.getState().setUpdateLastCheck(Date.now());
      if (res.status === "available") {
        const skipped = useSettings.getState().updateSkipped === res.release.version;
        set({ release: res.release, phase: "available", lastCheck: null, progress: NO_PROGRESS, error: null, dialogOpen: manual || !skipped });
      } else if (res.status === "upToDate") {
        set({ phase: prev === "available" ? "available" : "idle", lastCheck: { status: "upToDate", version: res.current } });
      } else {
        set({ phase: prev === "available" ? "available" : "idle", lastCheck: { status: "error", code: res.code, message: res.message } });
      }
    },

    async start() {
      const { release } = get();
      if (!release || isBusy(get().phase)) return;
      set({ phase: "downloading", error: null, progress: { downloaded: 0, total: release.asset.size, bytesPerSec: 0 } });
      try {
        await updaterApi.start(release);
      } catch (e) {
        set({ phase: "failed", error: failureOf(e), dialogOpen: true });
      }
    },

    async pause() {
      await updaterApi.control("pause").catch(() => undefined);
    },
    async resume() {
      await updaterApi.control("resume").catch(() => undefined);
    },
    async cancel() {
      await updaterApi.control("cancel").catch(() => undefined);
    },

    async apply(force = false) {
      if (get().phase !== "ready") return;
      if (!force && useSession.getState().pendingCount > 0) return set({ confirmUnsaved: true });
      set({ confirmUnsaved: false, phase: "applying" });
      try {
        await updaterApi.apply();
      } catch (e) {
        set({ phase: "failed", error: failureOf(e), dialogOpen: true });
      }
    },

    dismissUnsaved: () => set({ confirmUnsaved: false }),
    openDialog: () => set({ dialogOpen: true }),
    hideDialog: () => set({ dialogOpen: false }),

    skip() {
      const { release } = get();
      if (release) useSettings.getState().setUpdateSkipped(release.version);
      set({ dialogOpen: false, phase: "idle", release: null });
    },

    clearFailure: () => set({ error: null, phase: get().release ? "available" : "idle", progress: NO_PROGRESS }),
  };
});

/** Solo para las pruebas: permite volver a inicializar el store. */
export function resetUpdaterForTests() {
  started = false;
  useUpdater.setState({ supported: null, phase: "idle", release: null, progress: NO_PROGRESS, error: null, dialogOpen: false, confirmUnsaved: false, lastCheck: null });
}
