import { chromium, expect } from "../node_modules/@playwright/test/index.mjs";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Users/sujal/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  args: ["--use-angle=metal", "--enable-webgl"],
});
const url = "http://127.0.0.1:5188/tests/product-ui.harness.html";
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(url);
  await expect(p.getByRole("dialog")).toBeVisible();
  for (const axis of ["width", "depth", "height"])
    await expect(
      p.getByRole("spinbutton", { name: `Product ${axis}`, exact: true }),
    ).toHaveValue("");
  await expect(
    p.getByRole("button", { name: "Try in room", exact: true }),
  ).toBeDisabled();
  await p
    .getByLabel("Amazon or Flipkart product link", { exact: true })
    .fill("https://www.amazon.in/dp/B012345678");
  await p.getByRole("button", { name: "Read product", exact: true }).click();
  await expect(
    p.getByRole("textbox", { name: "Product name", exact: true }),
  ).toHaveValue("Test oak desk");
  await p
    .getByRole("textbox", { name: "Product specifications", exact: true })
    .fill("Desk. Width: 150.25 cm; Depth: 60 cm; Height: 75 cm");
  await p
    .getByRole("button", { name: "Read specifications", exact: true })
    .click();
  await expect(
    p.getByRole("spinbutton", { name: "Product width", exact: true }),
  ).toHaveValue("150.25");
  await p.getByRole("checkbox", { name: /I checked all three/ }).check();
  await expect(
    p.getByRole("button", { name: "Try in room", exact: true }),
  ).toBeEnabled();
  await p.getByRole("button", { name: "Save for later", exact: true }).click();
  await p.getByRole("tab", { name: /My products/ }).click();
  await expect(
    p.getByRole("heading", { name: "Test oak desk", exact: true }),
  ).toBeVisible();
  await p.getByRole("button", { name: "Review", exact: true }).click();
  const width = p.getByRole("spinbutton", {
    name: "Product width",
    exact: true,
  });
  await width.fill("");
  await width.pressSequentially("150.25", { delay: 20 });
  await width.press("Enter");
  await expect(width).toHaveValue("150.25");
  await p
    .getByRole("textbox", { name: "Product name", exact: true })
    .fill("Desk that stays");
  await p
    .getByLabel("Amazon or Flipkart product link", { exact: true })
    .fill("https://www.amazon.in/failure");
  await p.getByRole("button", { name: "Read product", exact: true }).click();
  await expect(p.getByRole("alert")).toContainText("kept");
  await expect(
    p.getByRole("textbox", { name: "Product name", exact: true }),
  ).toHaveValue("Desk that stays");
  await expect(width).toHaveValue("150.25");
  await expect(
    p.getByText("Detailed model generation is paused", { exact: true }),
  ).toBeVisible();
  await expect(
    p.getByRole("button", { name: "Create detailed model", exact: true }),
  ).toHaveCount(0);
  await p.screenshot({ path: "/tmp/product-workbench-desktop.png" });
  await p.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await p.screenshot({ path: "/tmp/product-workbench-mobile.png" });
  await p
    .getByRole("button", { name: "Close product workbench", exact: true })
    .click();
  await expect(p.getByText("Closed", { exact: true })).toBeVisible();
  await p.goto(url + "?ledger=empty");
  await expect(
    p.getByRole("heading", {
      name: "No processing recorded yet.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    p.getByRole("button", { name: "Export CSV", exact: true }),
  ).toBeDisabled();
  await expect(p.getByText("$0", { exact: true })).toHaveCount(0);
  await p.screenshot({ path: "/tmp/cost-time-mobile.png" });
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.goto(url + "?ledger=fixture");
  await p.getByRole("tab", { name: "Activity", exact: true }).click();
  await p
    .getByRole("button", {
      name: "Details for Test local import, attempt 1",
      exact: true,
    })
    .click();
  await expect(
    p.getByText("Local work · no provider charge", { exact: true }).first(),
  ).toBeVisible();
  await expect(p.getByText("1.5 s", { exact: true }).first()).toBeVisible();
  const downloading = p.waitForEvent("download");
  await p.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloading;
  if (!download.suggestedFilename().endsWith(".csv"))
    throw new Error("CSV download absent");
  await p.screenshot({ path: "/tmp/cost-time-desktop.png" });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Product UI browser checks passed: nullable dimensions, partial lookup, decimal entry, review gate, save/library, recovery, paused generation, mobile sizing/close, empty ledger, attempt detail, CSV.",
  );
} finally {
  await browser.close();
}
