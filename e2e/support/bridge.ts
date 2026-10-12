// Puente de pruebas e2e: sustituye al backend Tauri por el driver Ruby REAL.
// El navegador (Chromium + Vite) llama a `window.__TAURI_INTERNALS__.invoke`,
// que reenvia aqui; este modulo habla el protocolo JSON-por-linea con
// `ruby driver/rxdata_driver.rb`, igual que el crate Rust `rxdriver`.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

type Json = Record<string, unknown>;

export class DriverBridge {
  private proc: ChildProcessWithoutNullStreams;
  private pending: ((line: string) => void)[] = [];
  private buffer: string[] = [];
  private nextId = 1;
  dialogPath = "";
  locale = "es-ES";

  constructor(repoRoot: string) {
    this.proc = spawn("ruby", ["-E", "UTF-8", path.join(repoRoot, "driver", "rxdata_driver.rb")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, RUBYOPT: "", LC_ALL: "C.UTF-8" },
    });
    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      const waiter = this.pending.shift();
      if (waiter) waiter(line);
      else this.buffer.push(line);
    });
    this.proc.stderr.on("data", (d) => process.stderr.write(`[driver] ${d}`));
  }

  private send(cmd: string, params: Json = {}): Promise<Json> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      const onLine = (line: string) => resolve(JSON.parse(line) as Json);
      const queued = this.buffer.shift();
      if (queued !== undefined) onLine(queued);
      else this.pending.push(onLine);
      this.proc.stdin.write(JSON.stringify({ ...params, id, cmd }) + "\n");
    });
  }

  /** Atiende un `invoke` de Tauri. Devuelve { value } o { error } (el init
   *  script del navegador lo convierte en resolve/reject). */
  async handle(cmd: string, args: Json = {}): Promise<{ value?: unknown; error?: unknown }> {
    switch (cmd) {
      case "open_save": {
        await this.send("close");
        const res = await this.send("open", { path: args.path, autodetect: false });
        return this.wrap(res);
      }
      case "close_save":
        await this.send("close");
        return { value: null };
      case "driver_call": {
        const res = await this.send(String(args.cmd), (args.params as Json) ?? {});
        return this.wrap(res);
      }
      case "plugin:dialog|open":
        return { value: this.dialogPath };
      case "plugin:os|locale":
        return { value: this.locale };
      case "plugin:event|listen":
        return { value: 1 };
      default:
        return { value: null };
    }
  }

  private wrap(res: Json): { value?: unknown; error?: unknown } {
    if (res.ok) return { value: res };
    const e = (res.error ?? {}) as Json;
    return { error: { kind: e.type ?? "DriverError", message: e.message ?? "", params: e.params ?? null, fatal: false } };
  }

  async dispose() {
    try {
      await this.send("shutdown");
    } catch {
      /* ya cerrado */
    }
    this.proc.kill();
  }
}

/** Script que se inyecta en la pagina para simular el runtime de Tauri. */
export const TAURI_MOCK = `
  (() => {
    const callbacks = {};
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        const r = await window.__pwInvoke(cmd, args ?? {});
        if (r && r.error) throw r.error;
        return r ? r.value : null;
      },
      transformCallback: (cb) => { const id = Math.floor(Math.random() * 1e9); callbacks[id] = cb; return id; },
      convertFileSrc: (p) => p,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  })();
`;
