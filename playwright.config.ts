import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const installedChrome = join(
  homedir(),
  "Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const baseURL = process.env.ROOMSHIFT_BASE_URL ?? "http://127.0.0.1:5173";
const port = new URL(baseURL).port || "5173";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: process.env.CI ? 90_000 : 45_000,
  maxFailures: process.env.CI ? 1 : undefined,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    viewport: { width: 1512, height: 982 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      ...(existsSync(installedChrome)
        ? { executablePath: installedChrome }
        : {}),
      args: [
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--enable-unsafe-swiftshader",
      ],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: process.env.CI
      ? `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`
      : `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
