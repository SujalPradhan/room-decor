import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Project } from "../src/types";

const storageKey = "roomshift-project-v1";
async function openRoom(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A little shift/ }),
  ).toBeVisible();
  await expect(page.locator(".stage-loading")).toHaveCount(0, {
    timeout: 25_000,
  });
  await expect(page.locator(".scene-error")).toHaveCount(0);
  await expect(page.getByTestId("room-canvas").locator("canvas")).toBeVisible();
}
async function savedProject(
  page: Page,
  expected: (project: Project) => boolean = () => true,
): Promise<Project> {
  await expect
    .poll(
      async () => {
        const project = await page.evaluate((key) => {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : null;
        }, storageKey);
        return project !== null && expected(project);
      },
      {
        message: "The expected project change should reach persistent storage",
      },
    )
    .toBe(true);
  await expect(page.locator(".save-status")).toHaveText("Saved on this device");
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
}
async function uploadProject(page: Page, name: string, text: string) {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open project", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
}

test("loads a real rendered room without browser or asset errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  await openRoom(page);
  await expect(
    page.getByRole("button", { name: "Select Wooden bed", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Switch to Original", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page
        .getByTestId("room-canvas")
        .locator("canvas")
        .evaluate(
          (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png").length,
        ),
    )
    .toBeGreaterThan(10_000);
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});

test("edits a furniture assembly while preserving Original, with rotate undo and redo", async ({
  page,
}) => {
  await openRoom(page);
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Object width", exact: true }),
  ).toHaveValue("140");
  await page
    .getByRole("spinbutton", { name: "Object width", exact: true })
    .fill("150");
  await expect(
    page.getByRole("button", { name: "Switch to My layout", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Rotate right", exact: true }).click();
  await expect(page.getByText("180°", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("90°", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByText("180°", { exact: true })).toBeVisible();
  const p = await savedProject(
      page,
      (p) =>
        p.layouts
          .find((l) => l.id === p.activeLayoutId)!
          .items.find((i) => i.id === "bed")!.rotation === Math.PI,
    ),
    original = p.layouts.find((l) => l.id === "original")!,
    edited = p.layouts.find((l) => l.id === p.activeLayoutId)!;
  expect(original.items.find((i) => i.id === "bed")!.dimensions.width).toBe(
    1.4,
  );
  expect(original.items.find((i) => i.id === "bed")!.rotation).toBeCloseTo(
    Math.PI / 2,
  );
  expect(edited.items.find((i) => i.id === "bed")!.dimensions.width).toBe(1.5);
  expect(edited.items.find((i) => i.id === "bed")!.rotation).toBeCloseTo(
    Math.PI,
  );
  await page
    .getByRole("button", { name: "Switch to Original", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Object width", exact: true }),
  ).toHaveValue("140");
});

test("puts furniture aside and brings it back, with lock protecting dimensions", async ({
  page,
}) => {
  await openRoom(page);
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide Wooden bed", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Show Wooden bed", exact: true }),
  ).toBeVisible();
  let p = await savedProject(
    page,
    (p) =>
      !p.layouts
        .find((l) => l.id === p.activeLayoutId)!
        .items.find((i) => i.id === "bed")!.visible,
  );
  expect(
    p.layouts
      .find((l) => l.id === p.activeLayoutId)!
      .items.find((i) => i.id === "bed")!.visible,
  ).toBe(false);
  await page
    .getByRole("button", { name: "Show Wooden bed", exact: true })
    .click();
  await page.getByRole("button", { name: "Lock object", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Object width", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Rotate right", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Unlock object", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Object width", exact: true }),
  ).toBeEnabled();
  p = await savedProject(
    page,
    (p) =>
      p.layouts
        .find((l) => l.id === p.activeLayoutId)!
        .items.find((i) => i.id === "bed")!.visible,
  );
  expect(
    p.layouts
      .find((l) => l.id === p.activeLayoutId)!
      .items.find((i) => i.id === "bed")!.visible,
  ).toBe(true);
});

test("drags selected furniture in plan view and keeps the rendered position synchronized with the saved layout", async ({
  page,
}) => {
  await openRoom(page);
  await page.getByRole("button", { name: "2D plan", exact: true }).click();
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  const start = await page.evaluate(
    () =>
      (
        window as unknown as {
          __roomshiftScene: {
            projectedItems: Record<string, { x: number; y: number }>;
          };
        }
      ).__roomshiftScene.projectedItems.bed,
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 48, start.y + 32, { steps: 8 });
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Switch to My layout", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const project = await savedProject(page, (p) => {
      const i = p.layouts
        .find((l) => l.id === p.activeLayoutId)!
        .items.find((i) => i.id === "bed")!;
      return Math.hypot(i.position.x + 0.5, i.position.z - 0.05) > 0.1;
    }),
    item = project.layouts
      .find((l) => l.id === project.activeLayoutId)!
      .items.find((i) => i.id === "bed")!;
  expect(
    Math.hypot(item.position.x + 0.5, item.position.z - 0.05),
  ).toBeGreaterThan(0.1);
  const rendered = await page.evaluate(
    () =>
      (
        window as unknown as {
          __roomshiftScene: { items: Record<string, { x: number; z: number }> };
        }
      ).__roomshiftScene.items.bed,
  );
  expect(rendered.x).toBeCloseTo(item.position.x);
  expect(rendered.z).toBeCloseTo(item.position.z);
  expect(
    project.layouts
      .find((l) => l.id === "original")!
      .items.find((i) => i.id === "bed")!.position,
  ).toEqual({ x: -0.5, z: 0.05 });
});

test("keeps wall finishes together with a named saved layout and restores them on reload", async ({
  page,
}) => {
  await openRoom(page);
  await page
    .getByRole("button", { name: "Finishes", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Wall color #a7b5a0", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Accent color #c0a28d", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save a layout", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Save a layout",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "LAYOUT NAME", exact: true })
    .fill("Quiet mornings");
  await dialog
    .getByRole("button", { name: "Save layout", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Switch to Quiet mornings", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const p = await savedProject(
      page,
      (p) =>
        p.layouts.find((l) => l.id === p.activeLayoutId)!.name ===
        "Quiet mornings",
    ),
    l = p.layouts.find((l) => l.id === p.activeLayoutId)!;
  expect(l.wallColor).toBe("#a7b5a0");
  expect(l.accentColor).toBe("#c0a28d");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Switch to Quiet mornings", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Finishes", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Wall color #a7b5a0", exact: true }),
  ).toHaveClass(/chosen/);
});

test("switches plan, walk and orbit views and displays appropriate movement controls", async ({
  page,
}) => {
  await openRoom(page);
  await page.getByRole("button", { name: "2D plan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "2D plan", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".stage-instructions")).toContainText(
    "drag to move",
  );
  await page.getByRole("button", { name: "Walk inside", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Walk forward", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".stage-instructions")).toContainText("WASD");
  const before = await page.evaluate(
    () =>
      (window as unknown as { __roomshiftScene: { cameraPosition: number[] } })
        .__roomshiftScene.cameraPosition,
  );
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.keyboard.up("w");
  const after = await page.evaluate(
    () =>
      (window as unknown as { __roomshiftScene: { cameraPosition: number[] } })
        .__roomshiftScene.cameraPosition,
  );
  expect(
    Math.hypot(after[0] - before[0], after[2] - before[2]),
  ).toBeGreaterThan(0.05);
  await page.getByRole("button", { name: "3D view", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Walk forward", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "3D view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("zooms the actual 2D plan with the wheel and restores its scale with Reset view", async ({
  page,
}) => {
  await openRoom(page);
  await page.getByRole("button", { name: "2D plan", exact: true }).click();
  const canvas = page.getByTestId("room-canvas").locator("canvas"),
    box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -350);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __roomshiftScene: { planZoom: number } })
            .__roomshiftScene.planZoom,
      ),
    )
    .toBeGreaterThan(1.1);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __roomshiftScene: { planZoom: number } })
            .__roomshiftScene.planZoom,
      ),
    )
    .toBe(1);
});

test("exports and imports the actual project, and rejects malformed files without replacing work", async ({
  page,
}) => {
  await openRoom(page);
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Object width", exact: true })
    .fill("155");
  const saved = await savedProject(
    page,
    (p) =>
      p.layouts
        .find((l) => l.id === p.activeLayoutId)!
        .items.find((i) => i.id === "bed")!.dimensions.width === 1.55,
  );
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Project file/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("roomshift-project.json");
  const data = await readFile((await download.path())!, "utf8");
  expect(JSON.parse(data)).toEqual(saved);
  await page
    .getByRole("spinbutton", { name: "Object width", exact: true })
    .fill("170");
  await uploadProject(page, "restored-room.json", data);
  await expect(page.getByRole("status")).toContainText(
    "Project opened successfully",
  );
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Object width", exact: true }),
  ).toHaveValue("155");
  const restored = await savedProject(
    page,
    (p) =>
      p.layouts
        .find((l) => l.id === p.activeLayoutId)!
        .items.find((i) => i.id === "bed")!.dimensions.width === 1.55,
  );
  await uploadProject(page, "broken-room.json", '{"version":1,"room":null}');
  await expect(page.getByRole("status")).toContainText(
    "Could not open this room",
  );
  expect(await savedProject(page)).toEqual(restored);
});

test("updates room dimensions, recalculates the room label, and persists the new size", async ({
  page,
}) => {
  await openRoom(page);
  await page
    .getByRole("button", { name: "Edit room dimensions", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Room dimensions",
    exact: true,
  });
  await dialog
    .getByRole("spinbutton", { name: "Room width", exact: true })
    .fill("4.6");
  await dialog
    .getByRole("spinbutton", { name: "Room depth", exact: true })
    .fill("5.2");
  await dialog
    .getByRole("button", { name: "Update room", exact: true })
    .click();
  await expect(page.locator(".room-size")).toContainText("4.6 × 5.2 m");
  const project = await savedProject(
    page,
    (p) => p.room.width === 4.6 && p.room.depth === 5.2,
  );
  expect(project.room.width).toBe(4.6);
  expect(project.room.depth).toBe(5.2);
  await page.reload();
  await expect(page.locator(".room-size")).toContainText("4.6 × 5.2 m");
});

test("adds a dimensioned new piece and reports its collision when duplicated into occupied space", async ({
  page,
}) => {
  await openRoom(page);
  await page
    .getByRole("button", { name: "Add furniture", exact: false })
    .click();
  const catalog = page.getByRole("dialog", {
    name: "Add furniture",
    exact: true,
  });
  await catalog.getByRole("button", { name: /Potted plant/ }).click();
  await expect(catalog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Select Potted plant", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "Object width", exact: true })
    .fill("60");
  await page
    .getByRole("checkbox", {
      name: "I’ve checked these measurements",
      exact: true,
    })
    .check();
  const project = await savedProject(page, (p) =>
    p.layouts
      .find((l) => l.id === p.activeLayoutId)!
      .items.some(
        (i) =>
          i.kind === "plant" &&
          i.dimensions.width === 0.6 &&
          i.dimensionSource === "measured",
      ),
  );
  expect(
    project.layouts.find((l) => l.id === project.activeLayoutId)!.items,
  ).toHaveLength(8);
  await page
    .getByRole("spinbutton", { name: "Object width", exact: true })
    .fill("65");
  await expect(
    page.getByRole("checkbox", {
      name: "I’ve checked these measurements",
      exact: true,
    }),
  ).not.toBeChecked();
  await savedProject(page, (p) =>
    p.layouts
      .find((l) => l.id === p.activeLayoutId)!
      .items.some(
        (i) =>
          i.kind === "plant" &&
          i.dimensions.width === 0.65 &&
          i.dimensionSource === "estimated",
      ),
  );
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Select Potted plant copy", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".fit-note")).toContainText("overlaps");
  await expect(page.locator(".fit-note")).toHaveClass(/has-issues/);
  const duplicated = await savedProject(
    page,
    (p) => p.layouts.find((l) => l.id === p.activeLayoutId)!.items.length === 9,
  );
  expect(
    duplicated.layouts.find((l) => l.id === "original")!.items,
  ).toHaveLength(7);
});

test("rejects changes needing a thirteenth layout without losing saved work or leaving a dragged object displaced", async ({
  page,
}) => {
  await openRoom(page);
  const project = await savedProject(page),
    original = project.layouts.find((l) => l.id === "original")!;
  while (project.layouts.length < 12) {
    const index = project.layouts.length;
    project.layouts.push({
      ...JSON.parse(JSON.stringify(original)),
      id: `imported-${index}`,
      name: `Imported idea ${index}`,
    });
  }
  project.activeLayoutId = "original";
  await uploadProject(page, "twelve-layouts.json", JSON.stringify(project));
  await expect(page.getByRole("status")).toContainText(
    "Project opened successfully",
  );
  const baseline = await savedProject(
    page,
    (p) => p.layouts.length === 12 && p.activeLayoutId === "original",
  );
  await page
    .getByRole("button", { name: "Dismiss notification", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Object width", exact: true })
    .fill("160");
  await expect(page.getByRole("status")).toContainText("12 layouts");
  await expect(
    page.getByRole("spinbutton", { name: "Object width", exact: true }),
  ).toHaveValue("140");
  await expect(
    page.getByRole("button", { name: "Switch to Original", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await savedProject(page)).toEqual(baseline);
  await page.getByRole("button", { name: "2D plan", exact: true }).click();
  const start = await page.evaluate(
    () =>
      (
        window as unknown as {
          __roomshiftScene: {
            projectedItems: Record<string, { x: number; y: number }>;
          };
        }
      ).__roomshiftScene.projectedItems.bed,
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 50, start.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("status")).toContainText("12 layouts");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __roomshiftScene: {
                items: Record<string, { x: number; z: number }>;
              };
            }
          ).__roomshiftScene.items.bed,
      ),
    )
    .toEqual({ x: -0.5, z: 0.05 });
  expect(await savedProject(page)).toEqual(baseline);
  await page
    .getByRole("button", { name: "Save a layout", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Save a layout",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Save layout", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("textbox", { name: "LAYOUT NAME", exact: true })
    .press("Enter");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("status")).toContainText("12 layouts");
  expect(await savedProject(page)).toEqual(baseline);
});

test.describe("mobile furniture panels", () => {
  test.use({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
  });
  test("opens furniture and object dimensions, closes the overlay, and keeps the page within its viewport", async ({
    page,
  }) => {
    await openRoom(page);
    await page
      .getByRole("button", { name: "Furniture", exact: true })
      .last()
      .tap();
    await expect(
      page.getByRole("button", { name: "Close furniture panel", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Select Wooden bed", exact: true })
      .tap();
    await expect(
      page.getByRole("spinbutton", { name: "Object width", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("spinbutton", { name: "Object width", exact: true })
      .fill("145");
    await page
      .getByRole("button", { name: "Close properties", exact: true })
      .tap();
    await expect(
      page.getByRole("spinbutton", { name: "Object width", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("button", { name: "2D plan", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    const p = await savedProject(
      page,
      (p) =>
        p.layouts
          .find((l) => l.id === p.activeLayoutId)!
          .items.find((i) => i.id === "bed")!.dimensions.width === 1.45,
    );
    expect(
      p.layouts
        .find((l) => l.id === p.activeLayoutId)!
        .items.find((i) => i.id === "bed")!.dimensions.width,
    ).toBe(1.45);
  });
});
