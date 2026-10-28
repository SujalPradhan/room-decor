import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { Project } from "../src/types";

const storageKey = "roomshift-project-v1";
type SceneObservables = {
  cameraPosition: number[];
  itemDimensions: Record<
    string,
    { width: number; depth: number; height: number }
  >;
  itemAssets: Record<string, { assetId?: string; source: string }>;
};

async function openRoom(page: Page, url = "/") {
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: /A little shift/ }),
  ).toBeVisible();
  await expect(page.locator(".stage-loading")).toHaveCount(0, {
    timeout: 25_000,
  });
  await expect(page.locator(".scene-error")).toHaveCount(0);
}

async function savedProject(
  page: Page,
  matches: (p: Project) => boolean = () => true,
): Promise<Project> {
  await expect
    .poll(async () => {
      const p = await page.evaluate((key) => {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      }, storageKey);
      return p !== null && matches(p);
    })
    .toBe(true);
  await expect(page.locator(".save-status")).toHaveText("Saved on this device");
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
}

function bed(project: Project) {
  return project.layouts
    .find((l) => l.id === project.activeLayoutId)!
    .items.find((i) => i.id === "bed")!;
}

async function scene(page: Page): Promise<SceneObservables> {
  return page.evaluate(() => {
    const s = (window as unknown as { __roomshiftScene: SceneObservables })
      .__roomshiftScene;
    return {
      cameraPosition: s.cameraPosition,
      itemDimensions: s.itemDimensions,
      itemAssets: s.itemAssets,
    };
  });
}

async function startReplacement(page: Page, name = "Wooden bed") {
  await page
    .getByRole("button", { name: `Select ${name}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replace this piece", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Try a different piece.", exact: true }),
  ).toBeVisible();
}

async function importModel(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Bring your own 3D model/ }).click();
  await (await chooserPromise).setFiles(file);
}

test("previews a replacement at the same camera and cancels without saving or changing history", async ({
  page,
}) => {
  await openRoom(page);
  const baseline = await savedProject(page);
  await startReplacement(page);
  await page
    .getByRole("button", { name: "Try Oak platform bed", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Replacement width", exact: true }),
  ).toHaveValue("155");
  await expect
    .poll(async () => (await scene(page)).itemAssets.bed.source)
    .toBe("builtin");
  expect((await scene(page)).itemAssets.bed.assetId).toBe(
    "builtin:bed-platform",
  );
  await expect
    .poll(async () => (await scene(page)).itemDimensions.bed.width)
    .toBeCloseTo(1.55, 2);
  const after = await scene(page);
  expect(await savedProject(page)).toEqual(baseline);
  await page.getByRole("button", { name: "Before", exact: true }).click();
  await expect
    .poll(async () => (await scene(page)).itemDimensions.bed.width)
    .toBeCloseTo(1.4, 2);
  const before = await scene(page);
  before.cameraPosition.forEach((value, i) =>
    expect(value).toBeCloseTo(after.cameraPosition[i], 5),
  );
  await page.getByRole("button", { name: "After", exact: true }).click();
  await expect
    .poll(async () => (await scene(page)).itemDimensions.bed.width)
    .toBeCloseTo(1.55, 2);
  const again = await scene(page);
  again.cameraPosition.forEach((value, i) =>
    expect(value).toBeCloseTo(after.cameraPosition[i], 5),
  );
  await page
    .getByRole("button", { name: "Keep my current piece", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replace this piece", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await scene(page)).itemDimensions.bed.width)
    .toBeCloseTo(1.4, 2);
  expect(await savedProject(page)).toEqual(baseline);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
});

test("confirms a dimensioned replacement atomically, preserves Original and restores it with one Undo", async ({
  page,
}) => {
  await openRoom(page);
  const baseline = await savedProject(page),
    original = bed(baseline);
  await startReplacement(page);
  await page
    .getByRole("button", { name: "Try Oak platform bed", exact: true })
    .click();
  const checked = page.getByRole("checkbox", {
    name: "Dimensions checked against the actual piece",
    exact: true,
  });
  await checked.check();
  await page
    .getByRole("spinbutton", { name: "Replacement width", exact: true })
    .fill("160");
  await expect(checked).not.toBeChecked();
  await checked.check();
  await page
    .getByRole("button", { name: "Use this piece", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Replacement saved");
  const replaced = await savedProject(
    page,
    (p) =>
      bed(p).assetId === "builtin:bed-platform" &&
      bed(p).dimensions.width === 1.6,
  );
  expect(bed(replaced)).toMatchObject({
    id: original.id,
    position: original.position,
    rotation: original.rotation,
    dimensionSource: "product",
    assetId: "builtin:bed-platform",
  });
  expect(
    replaced.layouts.find((l) => l.id === replaced.activeLayoutId)!.items,
  ).toHaveLength(7);
  expect(replaced.layouts.find((l) => l.id === "original")).toEqual(
    baseline.layouts.find((l) => l.id === "original"),
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(
    await savedProject(page, (p) => p.activeLayoutId === "original"),
  ).toEqual(baseline);
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(
    await savedProject(page, (p) => bed(p).assetId === "builtin:bed-platform"),
  ).toEqual(replaced);
});

test("renders an imported local GLB, persists its ID across reload and rejects a malformed replacement", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  await openRoom(page);
  const baseline = await savedProject(page);
  await startReplacement(page);
  await importModel(page, resolve("public/assets/furniture.glb"));
  await expect(page.locator(".candidate-specs h3")).toHaveText("furniture");
  await expect
    .poll(async () => (await scene(page)).itemAssets.bed.source, {
      timeout: 25_000,
    })
    .toBe("local");
  expect(await savedProject(page)).toEqual(baseline);
  await page
    .getByRole("button", { name: "Use this piece", exact: true })
    .click();
  const saved = await savedProject(
    page,
    (p) => bed(p).assetId?.startsWith("local:") === true,
  );
  const assetId = bed(saved).assetId!;
  expect(assetId).toMatch(/^local:[0-9a-f-]{36}$/i);
  await page.reload();
  await expect(page.locator(".stage-loading")).toHaveCount(0, {
    timeout: 25_000,
  });
  await expect
    .poll(async () => (await scene(page)).itemAssets.bed.source, {
      timeout: 25_000,
    })
    .toBe("local");
  expect(bed(await savedProject(page)).assetId).toBe(assetId);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /Project file/ }).click();
  const exported = await readFile((await (await downloaded).path())!, "utf8");
  expect(bed(JSON.parse(exported)).assetId).toBe(assetId);
  expect(exported).not.toContain("base64");

  await startReplacement(page, "furniture");
  await importModel(page, {
    name: "broken.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from("not a valid model"),
  });
  await expect(page.getByRole("alert")).toContainText("too short");
  expect(await savedProject(page)).toEqual(saved);
  await page
    .getByRole("button", { name: "Keep my current piece", exact: true })
    .click();

  const otherContext = await browser.newContext({
    viewport: { width: 1512, height: 982 },
  });
  try {
    const otherPage = await otherContext.newPage();
    await openRoom(otherPage, page.url());
    const chooser = otherPage.waitForEvent("filechooser");
    await otherPage
      .getByRole("button", { name: "Open project", exact: true })
      .click();
    await (
      await chooser
    ).setFiles({
      name: "local-model-project.json",
      mimeType: "application/json",
      buffer: Buffer.from(exported),
    });
    await expect(otherPage.getByRole("status")).toContainText(
      "Project opened successfully",
    );
    await otherPage
      .getByRole("button", { name: "Select furniture", exact: true })
      .click();
    await expect(otherPage.locator(".missing-model-note")).toContainText(
      "not stored in this browser",
    );
    await expect
      .poll(async () => (await scene(otherPage)).itemAssets.bed.source)
      .toBe("fallback");
    expect(bed(await savedProject(otherPage)).assetId).toBe(assetId);
  } finally {
    await otherContext.close();
  }
});
