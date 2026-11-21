import { test, expect, type Page } from '@playwright/test';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('503')) errors.push(message.text()); });
  return errors;
}

async function fresh(page: Page) {
  await page.goto('/tower');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test('Tower Lab loads with the tower and floor rail', async ({ page }) => {
  const errors = watchErrors(page);
  await fresh(page);
  await expect(page.getByRole('heading', { name: 'Tower Lab', level: 1 })).toBeVisible();
  await expect(page.locator('.tower-scene canvas')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Floors' }).getByRole('button')).toHaveCount(18);
  await expect(page.getByText('Fictional tower, illustrative prices.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('pick a unit, fly in and furnish with the agent offline', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.route('**/api/tower-agent', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"TOWER_AGENT_UNAVAILABLE","message":"off"}}' }));
  await fresh(page);
  await page.getByRole('button', { name: /^Floor 12,/ }).click();
  const units = page.getByRole('region', { name: 'Floor 12 units' });
  await units.locator('.tower-unit').first().click();
  const card = page.getByRole('region', { name: /^Unit 12/ });
  await expect(card.getByRole('button', { name: 'Fly in' })).toBeVisible();
  await card.getByRole('button', { name: 'Fly in' }).click();
  await expect(page.getByRole('button', { name: 'Back to tower' })).toBeVisible();
  await page.getByRole('button', { name: 'Furnish it for me' }).click();
  const result = page.getByRole('region', { name: 'Furnishing result' });
  await expect(result).toBeVisible({ timeout: 60_000 });
  await expect(result.getByText('Total', { exact: true })).toBeVisible();
  await expect(result.getByText(/Every piece fits/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to tower' }).click();
  await expect(page.getByRole('navigation', { name: 'Floors' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('pin two units to compare', async ({ page }) => {
  const errors = watchErrors(page);
  await fresh(page);
  for (const floor of [6, 14]) {
    await page.getByRole('button', { name: new RegExp(`^Floor ${floor},`) }).click();
    await page.locator('.tower-unit').first().click();
    await page.getByRole('button', { name: 'Pin to compare' }).click();
  }
  const compare = page.getByRole('region', { name: 'Compare units' });
  await expect(compare.getByRole('columnheader')).toHaveCount(3);
  await expect(compare.getByText('Flat plus furnishing')).toBeVisible();
  expect(errors).toEqual([]);
});

test('no horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fresh(page);
  await expect(page.locator('.tower-scene canvas')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
