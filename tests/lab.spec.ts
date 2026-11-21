import { test, expect, type Page } from '@playwright/test';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

test('the studio switch links to Design Lab', async ({ page }) => {
  await page.goto('/');
  const link = page.getByRole('group', { name: 'Space', exact: true }).getByRole('link', { name: 'Design Lab', exact: true });
  await expect(link).toHaveAttribute('href', '/lab');
});

test('Design Lab loads with meters and the x-ray toggle', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: 'Design Lab', level: 1 })).toBeVisible();
  await expect(page.locator('.lab-scene canvas')).toBeVisible();
  const meters = page.getByRole('region', { name: 'Meters' });
  await expect(meters.getByRole('meter')).not.toHaveCount(0);
  await expect(meters.getByText('Cost')).toBeVisible();
  const xray = page.getByRole('button', { name: 'X-ray' });
  await expect(xray).toHaveAttribute('aria-pressed', 'false');
  await xray.click();
  await expect(xray).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('list', { name: 'Cable colours' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the smoke drill shows who gets out in time', async ({ page }) => {
  await page.goto('/lab');
  await page.getByRole('button', { name: 'Smoke drill', exact: true }).click();
  const card = page.getByRole('region', { name: 'Smoke drill', exact: true });
  await expect(card).toBeVisible();
  await expect(card.getByText('A simple model for showing direction and timing, not a fire safety assessment.')).toBeVisible();
  await expect(card.locator('.lab-people li')).toHaveCount(14);
  await card.getByRole('slider', { name: 'Time in seconds' }).fill('10');
  await expect(card.locator('output')).toContainText('10 s');
});

test('an agent answer is applied at once, numbered in the room and explained in plain words', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await page.route('**/api/lab-agent', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"LAB_AGENT_UNAVAILABLE","message":"off"}}' }));
  await page.goto('/lab');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const problems = page.getByRole('region', { name: 'Problems' });
  await expect(problems.getByRole('heading')).toContainText('problems in this office');
  await page.getByRole('button', { name: 'Fix every problem', exact: true }).click();
  const changes = page.getByRole('region', { name: 'What the agent changed' });
  await expect(changes.getByRole('heading')).toContainText(/The agent made \d+ changes?/);
  await expect(changes.getByText(/Fixed \d+ problems?/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.locator('.lab-scene-tag')).toContainText(/Change 1 of \d+/);
  await expect(problems.getByRole('heading')).toHaveText('No problems found', { timeout: 150_000 });
  await expect(page.locator('.lab-scene-tag')).toContainText('Green numbers mark what the agent changed');
  await changes.getByRole('button', { name: 'Undo' }).click();
  await expect(problems.getByRole('heading')).toContainText('problems in this office');
  expect(errors.filter(error => !error.includes('503'))).toEqual([]);
});
