import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const url = "http://127.0.0.1:5174";
const vite = join(root, "node_modules/vite/bin/vite.js");
if (!existsSync(vite)) {
  console.log("Installing Roomshift dependencies…");
  const installer = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["ci"],
    { cwd: root, stdio: "inherit" },
  );
  const code = await new Promise((resolve) => installer.on("exit", resolve));
  if (code !== 0) process.exit(code ?? 1);
}
try {
  const response = await fetch(url);
  const text = await response.text();
  if (response.ok && text.includes("Roomshift")) {
    console.log(`Roomshift is already running: ${url}`);
    if (process.platform === "darwin")
      spawn("open", [url], { stdio: "ignore" }).unref();
    process.exit(0);
  }
} catch {}
const child = spawn(
  process.execPath,
  [vite, "--host", "127.0.0.1", "--port", "5174", "--strictPort"],
  { cwd: root, stdio: "inherit" },
);
const timer = setInterval(async () => {
  try {
    const response = await fetch(url);
    if (response.ok) {
      clearInterval(timer);
      console.log(
        `\nRoomshift is ready: ${url}\nLeave this window open. Press Ctrl+C to stop.\n`,
      );
      if (process.platform === "darwin")
        spawn("open", [url], { stdio: "ignore" }).unref();
    }
  } catch {}
}, 400);
process.on("SIGINT", () => {
  clearInterval(timer);
  child.kill("SIGINT");
});
process.on("SIGTERM", () => {
  clearInterval(timer);
  child.kill("SIGTERM");
});
child.on("exit", (code) => {
  clearInterval(timer);
  process.exit(code ?? 0);
});
