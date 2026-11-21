import { test, expect, type Page } from '@playwright/test';

const panelsKey = 'roomshift-panels-v1';
async function open(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.stage-loading')).toHaveCount(0, { timeout: 30000 });
}
const stageSize = (page: Page) => page.locator('.stage').evaluate(stage => { const box = stage.getBoundingClientRect(); return { width: box.width, height: box.height }; });
const fitsWindow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 4);

test('the side panel and layout strip collapse, give the room more space, and are remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await open(page);
  await page.evaluate(key => localStorage.removeItem(key), panelsKey);
  await open(page);
  const before = await stageSize(page);

  await page.getByRole('button', { name: 'Hide furniture panel' }).click();
  await expect(page.getByRole('button', { name: 'Show furniture panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Add furniture/ })).toBeHidden();
  await page.getByRole('button', { name: 'Hide layout cards' }).click();
  await expect(page.getByRole('button', { name: /^Switch to / }).first()).toBeHidden();
  const after = await stageSize(page);
  expect(after.width).toBeGreaterThan(before.width + 120);
  expect(after.height).toBeGreaterThan(before.height + 50);
  expect(await fitsWindow(page)).toBe(true);

  await open(page);
  await expect(page.getByRole('button', { name: 'Show furniture panel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show layout cards' })).toHaveAttribute('aria-expanded', 'false');

  // The collapsed strip still switches layouts.
  await page.getByRole('group', { name: 'Layouts' }).getByRole('button', { name: 'Work & rest' }).click();
  await expect(page.locator('#layout-walkthrough-heading')).toContainText('Work & rest');
  await page.getByRole('button', { name: /Skip to layout/ }).click();
  await expect(page.getByRole('group', { name: 'Layouts' }).getByRole('button', { name: 'Work & rest' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Show furniture panel' }).click();
  await page.getByRole('button', { name: 'Show layout cards' }).click();
  await expect(page.getByRole('button', { name: /^Add furniture/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch to Work & rest' })).toBeVisible();
  expect(await stageSize(page)).toEqual(before);
});

test('phones keep the furniture drawer and full layout strip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByRole('button', { name: 'Hide furniture panel' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Hide layout cards' })).toBeHidden();
  expect(await fitsWindow(page)).toBe(true);
});
