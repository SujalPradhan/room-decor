// Opt-in test against an unlocked Android Chrome tab. It never opens other tabs
// or changes phone settings, and restores the app's stored project afterwards.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const endpoint = process.env.ROOMSHIFT_CDP_URL ?? "http://127.0.0.1:9223";
const target = process.env.ROOMSHIFT_DEVICE_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.connectOverCDP(endpoint);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().startsWith(target));
assert(
  page,
  "Open Roomshift on the connected phone before running this script.",
);
const cdp = await page.context().newCDPSession(page);
const baseline = await page.evaluate(() =>
  localStorage.getItem("roomshift-project-v1"),
);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const report = {
  date: "2026-10-28",
  build: "production",
  checks: [],
  environment: null,
  performance: null,
  errors,
};
await mkdir("artifacts/phone", { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const button = (name) => page.getByRole("button", { name, exact: true });
async function touchStart(points) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points.map((p, i) => ({
      id: i + 1,
      x: p.x,
      y: p.y,
      radiusX: 3,
      radiusY: 3,
      force: 1,
    })),
  });
}
async function touchMove(points) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: points.map((p, i) => ({
      id: i + 1,
      x: p.x,
      y: p.y,
      radiusX: 3,
      radiusY: 3,
      force: 1,
    })),
  });
}
async function touchEnd() {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}
async function tap(locator) {
  await locator.waitFor({ state: "visible", timeout: 15000 });
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  assert(b);
  await touchStart([{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]);
  await pause(65);
  await touchEnd();
  await pause(180);
}
async function check(name, fn) {
  const start = Date.now();
  const detail = await fn();
  report.checks.push({
    name,
    passed: true,
    durationMs: Date.now() - start,
    ...(detail ? { detail } : {}),
  });
  console.log("PASS", name, detail ?? "");
}
async function readProject() {
  await pause(450);
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("roomshift-project-v1")),
  );
}
function active(p) {
  return p.layouts.find((l) => l.id === p.activeLayoutId);
}

let failure;
try {
  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.waitForFunction(
    () =>
      window.__roomshiftScene?.ready &&
      window.__roomshiftScene.assetSource === "blender",
  );
  report.environment = await page.evaluate(() => {
    const canvas = document.querySelector("canvas"),
      gl = canvas.getContext("webgl2"),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      renderer: ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      vendor: ext
        ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR),
      hardwareConcurrency: navigator.hardwareConcurrency,
      assetSource: window.__roomshiftScene.assetSource,
      drawCalls: window.__roomshiftScene.drawCalls,
      triangles: window.__roomshiftScene.triangles,
    };
  });
  await check("Actual hardware rendering and mobile layout", async () => {
    assert.equal(report.environment.assetSource, "blender");
    assert(await page.locator("canvas").isVisible());
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    return report.environment;
  });
  await page.screenshot({
    path: "artifacts/phone/initial.png",
    fullPage: true,
  });
  await check(
    "Touch furniture selection and dimension edit preserve Original",
    async () => {
      await tap(page.locator(".mobile-furniture-button"));
      await tap(button("Select Wooden bed"));
      const input = page.getByRole("spinbutton", {
        name: "Object width",
        exact: true,
      });
      await input.fill("150");
      await pause(500);
      const p = await readProject();
      assert.equal(
        p.layouts
          .find((l) => l.id === "original")
          .items.find((i) => i.id === "bed").dimensions.width,
        1.4,
      );
      assert.equal(
        active(p).items.find((i) => i.id === "bed").dimensions.width,
        1.5,
      );
      assert.notEqual(p.activeLayoutId, "original");
    },
  );
  await check("Touch rotate, hide and restore", async () => {
    await tap(button("Rotate right"));
    let p = await readProject();
    assert(
      Math.abs(active(p).items.find((i) => i.id === "bed").rotation - Math.PI) <
        0.001,
    );
    await tap(button("Put aside"));
    p = await readProject();
    assert.equal(active(p).items.find((i) => i.id === "bed").visible, false);
    await tap(button("Bring back"));
    p = await readProject();
    assert.equal(active(p).items.find((i) => i.id === "bed").visible, true);
    await tap(button("Close properties"));
  });
  await check(
    "Touch plan drag updates saved and rendered furniture",
    async () => {
      await tap(button("2D plan"));
      const start = await page.evaluate(
        () => window.__roomshiftScene.projectedItems.bed,
      );
      const before = await readProject();
      const original = {
        ...active(before).items.find((i) => i.id === "bed").position,
      };
      await touchStart([start]);
      for (let i = 1; i <= 8; i++) {
        await touchMove([
          { x: start.x + (35 * i) / 8, y: start.y + (24 * i) / 8 },
        ]);
        await pause(30);
      }
      await touchEnd();
      await pause(400);
      const p = await readProject(),
        position = active(p).items.find((i) => i.id === "bed").position;
      assert(
        Math.hypot(position.x - original.x, position.z - original.z) > 0.1,
      );
      const rendered = await page.evaluate(
        () => window.__roomshiftScene.items.bed,
      );
      assert(
        Math.abs(rendered.x - position.x) < 0.01 &&
          Math.abs(rendered.z - position.z) < 0.01,
      );
    },
  );
  await check("Actual two-finger plan pinch and reset", async () => {
    await tap(button("Reset view"));
    const bounds = await page.locator("canvas").boundingBox(),
      x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height * 0.58;
    await touchStart([
      { x: x - 32, y },
      { x: x + 32, y },
    ]);
    for (let i = 1; i <= 8; i++) {
      await touchMove([
        { x: x - 32 - (38 * i) / 8, y },
        { x: x + 32 + (38 * i) / 8, y },
      ]);
      await pause(35);
    }
    await touchEnd();
    const zoom = await page.evaluate(() => window.__roomshiftScene.planZoom);
    assert(zoom > 1.3, `Expected pinch zoom, got ${zoom}`);
    await tap(button("Reset view"));
    assert.equal(
      await page.evaluate(() => window.__roomshiftScene.planZoom),
      1,
    );
    return { pinchZoom: zoom };
  });
  await check("Touch wall finishes and save/reload", async () => {
    await tap(
      page
        .locator(".mobile-toolbar")
        .getByRole("button", { name: "Finishes", exact: true }),
    );
    await tap(button("Wall color #a7b5a0"));
    await tap(button("Close properties"));
    await tap(
      page
        .locator(".mobile-toolbar")
        .getByRole("button", { name: "Save", exact: true }),
    );
    await page.getByRole("dialog").getByRole("textbox").fill("POCO validation");
    await tap(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Save layout", exact: true }),
    );
    await pause(450);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__roomshiftScene?.ready);
    const p = await readProject();
    assert.equal(active(p).name, "POCO validation");
    assert.equal(active(p).wallColor, "#a7b5a0");
  });
  await check(
    "Touch walkthrough moves and stops at a furniture obstacle",
    async () => {
      await tap(button("Walk inside"));
      const b = await button("Walk forward").boundingBox(),
        point = { x: b.x + b.width / 2, y: b.y + b.height / 2 },
        before = await page.evaluate(
          () => window.__roomshiftScene.cameraPosition,
        );
      await touchStart([point]);
      await pause(5000);
      await touchEnd();
      const after = await page.evaluate(
        () => window.__roomshiftScene.cameraPosition,
      );
      assert(
        Math.hypot(after[0] - before[0], after[2] - before[2]) > 0.3,
        JSON.stringify({ before, after }),
      );
      await touchStart([point]);
      await pause(900);
      await touchEnd();
      const stopped = await page.evaluate(
        () => window.__roomshiftScene.cameraPosition,
      );
      assert(
        Math.hypot(stopped[0] - after[0], stopped[2] - after[2]) < 0.12,
        "Camera should stop at the blocking obstacle",
      );
      return { before, after, stopped };
    },
  );
  await check("Short on-device animated frame-time sample", async () => {
    await tap(button("Reset view"));
    const b = await button("Walk forward").boundingBox();
    await touchStart([{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]);
    report.performance = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const intervals = [];
          let previous = performance.now(),
            start = previous;
          function frame(now) {
            intervals.push(now - previous);
            previous = now;
            if (now - start < 3000) {
              requestAnimationFrame(frame);
              return;
            }
            const sorted = intervals.slice(1).sort((a, b) => a - b),
              mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
            resolve({
              durationMs: now - start,
              frames: sorted.length,
              meanFrameMs: mean,
              medianFrameMs: sorted[Math.floor(sorted.length * 0.5)],
              p95FrameMs: sorted[Math.floor(sorted.length * 0.95)],
              approximateRafHz: 1000 / mean,
              note: "One short sample during camera movement; not a sustained benchmark.",
            });
          }
          requestAnimationFrame(frame);
        }),
    );
    await touchEnd();
    return report.performance;
  });
  await check("No JavaScript errors during device interactions", async () =>
    assert.deepEqual(errors, []),
  );
  await tap(button("3D view"));
  await page.screenshot({
    path: "artifacts/phone/after-checks.png",
    fullPage: true,
  });
} catch (e) {
  failure = e;
  report.failure = e.stack ?? String(e);
  await page
    .screenshot({ path: "artifacts/phone/failure.png", fullPage: true })
    .catch(() => {});
  console.error("DEVICE CHECK FAILED", e.message);
} finally {
  await touchEnd().catch(() => {});
  await page
    .evaluate((value) => {
      if (value === null) localStorage.removeItem("roomshift-project-v1");
      else localStorage.setItem("roomshift-project-v1", value);
    }, baseline)
    .catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await writeFile(
    "artifacts/phone/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await cdp.detach();
}
console.log(
  JSON.stringify(
    {
      passed: report.checks.length,
      failure: report.failure ?? null,
      performance: report.performance,
    },
    null,
    2,
  ),
);
// Do not close the user's browser or any of its tabs.
process.exit(failure ? 1 : 0);
