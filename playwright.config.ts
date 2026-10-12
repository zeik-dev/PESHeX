import { defineConfig } from "@playwright/test";

// Pruebas visuales/e2e: Vite sirve la UI y un puente (e2e/support/bridge.ts)
// reemplaza el backend de Tauri por el driver Ruby real.
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1280, height: 820 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "npx vite --port 1420 --strictPort",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
