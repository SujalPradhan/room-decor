import { test, expect, type Page } from "@playwright/test";
import { createInitialProject } from "../src/domain";
import type { Project } from "../src/types";

const key = "roomshift-project-v1";
async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator(".stage-loading")).toHaveCount(0, {
    timeout: process.env.CI ? 60_000 : 25_000,
  });
  await expect(page.locator(".scene-error")).toHaveCount(0);
}
async function project(page: Page): Promise<Project> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
}
function active(p: Project) {
  return p.layouts.find((l) => l.id === p.activeLayoutId)!;
}
async function settled(page: Page, check: (p: Project) => boolean) {
  await expect
    .poll(async () => {
      const p = await project(page);
      return !!p && check(p);
    })
    .toBe(true);
}

test("Delete removes the complete component and Ctrl+Z / redo restore it", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete object", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select Wooden bed", exact: true }),
  ).toHaveCount(0);
  await settled(page, (p) => active(p).items.length === 6);
  expect(
    (await project(page)).layouts.find((l) => l.id === "original")!.items,
  ).toHaveLength(7);
  await expect
    .poll(() =>
      page.evaluate(() => !!(window as any).__roomshiftScene.items.bed),
    )
    .toBe(false);
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("button", { name: "Select Wooden bed", exact: true }),
  ).toBeVisible();
  await settled(page, (p) => active(p).items.length === 7);
  await expect
    .poll(() =>
      page.evaluate(() => !!(window as any).__roomshiftScene.items.bed),
    )
    .toBe(true);
  await page.keyboard.press("Control+Shift+z");
  await settled(page, (p) => active(p).items.length === 6);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Select Wooden bed", exact: true }),
  ).toHaveCount(0);
});

test("keyboard Delete respects input focus and locking, and Backspace is undoable", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  const width = page.getByRole("spinbutton", {
    name: "Object width",
    exact: true,
  });
  await width.focus();
  await width.press("ControlOrMeta+a");
  await width.press("Delete");
  await expect(width).toHaveValue("");
  expect(active(await project(page)).items).toHaveLength(7);
  await width.press("Escape");
  await expect(width).toHaveValue("140");
  await page.getByRole("button", { name: "Lock object", exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("status")).toContainText("Unlock");
  await settled(page, (p) => active(p).items.length === 7);
  await page
    .getByRole("button", { name: "Unlock object", exact: true })
    .click();
  await page.keyboard.press("Delete");
  await settled(page, (p) => active(p).items.length === 6);
  await page.keyboard.press("Control+z");
  await settled(page, (p) => active(p).items.length === 7);
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await page.getByRole("button", { name: "Reset view", exact: true }).focus();
  await page.keyboard.press("Backspace");
  await settled(page, (p) => active(p).items.length === 6);
  await page.keyboard.press("Control+z");
  await settled(page, (p) => active(p).items.length === 7);
});

test("width depth and height accept sequential typing of 150 and undo once per finished field", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  for (const axis of ["width", "depth", "height"] as const) {
    const input = page.getByRole("spinbutton", {
      name: `Object ${axis}`,
      exact: true,
    });
    await input.fill("");
    await input.pressSequentially("150", { delay: 35 });
    await expect(input).toHaveValue("150");
    await input.press("Enter");
    await settled(
      page,
      (p) =>
        active(p).items.find((i) => i.id === "bed")!.dimensions[axis] === 1.5,
    );
  }
  await page.keyboard.press("Control+z");
  await settled(
    page,
    (p) =>
      active(p).items.find((i) => i.id === "bed")!.dimensions.height === 0.85 &&
      active(p).items.find((i) => i.id === "bed")!.dimensions.depth === 1.5,
  );
  await page.keyboard.press("Control+z");
  await settled(
    page,
    (p) =>
      active(p).items.find((i) => i.id === "bed")!.dimensions.depth === 2.05 &&
      active(p).items.find((i) => i.id === "bed")!.dimensions.width === 1.5,
  );
  await page.keyboard.press("Control+z");
  await settled(
    page,
    (p) =>
      p.activeLayoutId === "original" &&
      active(p).items.find((i) => i.id === "bed")!.dimensions.width === 1.4,
  );
});

test("empty and invalid dimensions keep the old value, Escape cancels and decimals survive reload", async ({
  page,
}) => {
  const initial = createInitialProject();
  initial.layouts[0].items[0].dimensionSource = "product";
  await page.addInitScript(
    ({ key, initial }) => {
      if (!localStorage.getItem("measurement-fixture-ready")) {
        localStorage.setItem(key, JSON.stringify(initial));
        localStorage.setItem("measurement-fixture-ready", "yes");
      }
    },
    { key, initial },
  );
  await open(page);
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  const input = page.getByRole("spinbutton", {
    name: "Object width",
    exact: true,
  });
  await expect(input).toBeEnabled();
  for (const raw of ["", "1", "-3", "2500"]) {
    await input.fill(raw);
    await input.press("Tab");
    await expect(input).toHaveValue("140");
    await expect(input).toHaveAttribute("aria-invalid", "true");
  }
  await input.fill("150");
  await input.press("Escape");
  await expect(input).toHaveValue("140");
  await input.fill("");
  await input.pressSequentially("150.25", { delay: 30 });
  await input.press("Tab");
  await settled(
    page,
    (p) =>
      active(p).items.find((i) => i.id === "bed")!.dimensions.width ===
        1.5025 &&
      active(p).items.find((i) => i.id === "bed")!.dimensionSource ===
        "estimated",
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "Object width", exact: true }),
  ).toHaveValue("150.25");
});

test("replacement dimensions can be typed fully and committed by clicking Use this piece", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Select Wooden bed", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replace this piece", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Try Oak platform bed", exact: true })
    .click();
  const input = page.getByRole("spinbutton", {
    name: "Replacement width",
    exact: true,
  });
  await input.fill("");
  await input.pressSequentially("150", { delay: 35 });
  await expect(input).toHaveValue("150");
  expect(
    active(await project(page)).items.find((i) => i.id === "bed")!.dimensions
      .width,
  ).toBe(1.4);
  await page
    .getByRole("button", { name: "Use this piece", exact: true })
    .click();
  await settled(
    page,
    (p) =>
      active(p).items.find((i) => i.id === "bed")!.dimensions.width === 1.5,
  );
  await page.keyboard.press("Control+z");
  await settled(
    page,
    (p) =>
      active(p).items.find((i) => i.id === "bed")!.dimensions.width === 1.4,
  );
});
