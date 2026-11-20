import { test, expect, type Page } from '@playwright/test';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('503')) errors.push(message.text()); });
  return errors;
}

async function fresh(page: Page) {
  await page.goto('/bracket');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

test('Bracket Lab loads with the starting failures and 23 matrix rows', async ({ page }) => {
  const errors = watchErrors(page);
  await fresh(page);
  await expect(page.getByRole('heading', { name: 'Bracket Lab', level: 1 })).toBeVisible();
  await expect(page.locator('.bracket-scene canvas')).toBeVisible();
  const report = page.getByRole('region', { name: 'Verification report' });
  await expect(report.locator('tbody tr.bracket-row')).toHaveCount(23);
  await expect(report.getByText('Analysis and inspection only. Not a claim of compliance: tests need CAE or physical testing, deviations need your approval.')).toBeVisible();
  await expect(report.getByText('FAIL', { exact: true }).first()).toBeVisible();
  await expect(report.getByRole('button', { name: 'Approve design' })).toBeDisabled();
  const first = report.locator('.bracket-expand').first();
  await first.click();
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  expect(errors).toEqual([]);
});

test('with the agent offline the optimiser passes and the design can be approved', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/api/bracket-agent', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"BRACKET_AGENT_UNAVAILABLE","message":"off"}}' }));
  await fresh(page);
  await page.getByRole('button', { name: 'Design the riser pair' }).click();
  const iterations = page.getByRole('region', { name: 'Iterations' });
  await expect(iterations).toBeVisible({ timeout: 30_000 });
  const report = page.getByRole('region', { name: 'Verification report' });
  await expect(iterations.getByText(/no failed clauses/)).toBeVisible({ timeout: 90_000 });
  await expect(report.getByText('0 FAIL', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Design the riser pair' }).waitFor({ timeout: 30_000 });
  await report.getByLabel('Your name').fill('Test Client');
  const approve = report.getByRole('button', { name: 'Approve design' });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(report.getByRole('status').filter({ hasText: /Approved by Test Client on \d{4}-\d{2}-\d{2}/ })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Approved by Test Client/)).toBeVisible();
});

for (const side of ['RH', 'LH']) {
  test(`the STL download fires for ${side}`, async ({ page }) => {
    await page.goto('/bracket');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: `Download STL ${side}` }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.stl$/);
  });
}
