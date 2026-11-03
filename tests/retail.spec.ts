import { test, expect, type Page } from '@playwright/test';

const roomKey = 'roomshift-project-v1', storeKey = 'roomshift-store-project-v1';
const storeKinds = ['Display table', 'Wall display', 'Testing bar', 'Consultation station', 'Hero plinth', 'Checkout counter', 'Lounge bench', 'Potted plant', 'Small stool', 'Office chair', 'Bookshelf'];

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function open(page: Page, path: string, key: string) {
  await page.goto(path);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.stage-loading')).toHaveCount(0, { timeout: 30000 });
  await expect.poll(() => page.evaluate(k => localStorage.getItem(k), key)).not.toBeNull();
}
const saved = (page: Page, key: string) => page.evaluate(k => JSON.parse(localStorage.getItem(k)!), key);
const spaceButton = (page: Page, name: 'Bedroom' | 'Store') => page.getByRole('group', { name: 'Space', exact: true }).getByRole('button', { name, exact: true });
const pressed = (page: Page, name: 'Bedroom' | 'Store') => expect(spaceButton(page, name)).toHaveAttribute('aria-pressed', 'true');
const layoutButton = (page: Page, name: string) => page.getByRole('button', { name: `Switch to ${name}`, exact: true });
async function add(page: Page, name: string) {
  await page.getByRole('button', { name: /^Add (furniture|fixtures)/ }).click();
  await page.getByRole('dialog', { name: /^Add (furniture|fixtures)/ }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
const itemNames = async (page: Page, key: string) => {
  const project = await saved(page, key);
  return project.layouts.find((l: { id: string }) => l.id === project.activeLayoutId).items.map((i: { name: string }) => i.name) as string[];
};

test('a store link opens the store with its own layouts, catalogue and wording', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?space=retail', storeKey);
  await pressed(page, 'Store');
  for (const name of ['Classic boutique', 'Discovery journey', 'Open event']) await expect(layoutButton(page, name)).toBeVisible();
  await expect(layoutButton(page, 'Open & airy')).toHaveCount(0);
  expect((await saved(page, storeKey)).space).toBe('retail');
  expect(await page.evaluate(k => localStorage.getItem(k), roomKey)).toBeNull();
  await expect(page.locator('.breadcrumb')).toContainText('Experiential store');
  await expect(page.getByRole('heading', { name: 'A little shift. A whole new store.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Describe what you want from this store', exact: true })).toHaveAttribute('placeholder', 'Ask the store agent…');
  await expect(page.getByRole('button', { name: 'Rearrange the store', exact: true })).toBeAttached();
  await page.getByRole('textbox', { name: 'Describe what you want from this store', exact: true }).focus();
  for (const chip of ['Make room for an event', 'Guide customers past the testing bars', 'Add another testing bar']) await expect(page.getByRole('button', { name: chip, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to the original', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit store dimensions', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Store dimensions' }).getByRole('button', { name: /Update store/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Add fixtures', exact: false }).click();
  await expect(page.locator('.catalog-grid strong')).toHaveText(storeKinds);
  if (process.env.ROOMSHIFT_STORE_SHOT) {
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: process.env.ROOMSHIFT_STORE_SHOT });
  }
  expect(errors).toEqual([]);
});

test('each space keeps its own edits, and the last space is remembered', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/', roomKey);
  await pressed(page, 'Bedroom');
  await expect(page.locator('.catalog-grid')).toHaveCount(0);
  await add(page, 'Potted plant');
  await spaceButton(page, 'Store').click();
  await pressed(page, 'Store');
  await expect.poll(() => page.url()).toContain('space=retail');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(page.locator('.item-row.selected')).toHaveCount(0);
  await expect.poll(() => page.evaluate(k => localStorage.getItem(k), storeKey)).not.toBeNull();
  expect(await itemNames(page, roomKey)).toContain('Potted plant');
  await add(page, 'Testing bar');
  await expect.poll(async () => (await itemNames(page, storeKey)).filter(n => n === 'Testing bar').length).toBeGreaterThan(0);
  const store = await saved(page, storeKey);

  await spaceButton(page, 'Bedroom').focus();
  await page.keyboard.press('Enter');
  await pressed(page, 'Bedroom');
  await expect(layoutButton(page, 'Open & airy')).toBeVisible();
  await expect(page.locator('.breadcrumb')).toContainText('My bedroom');
  await expect(page.getByRole('button', { name: 'Rearrange the room', exact: true })).toBeAttached();
  await page.getByRole('button', { name: 'Add furniture', exact: false }).click();
  await expect(page.locator('.catalog-grid strong')).not.toContainText(['Testing bar']);
  await expect(page.locator('.catalog-grid strong').first()).toHaveText('Wooden bed');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('.item-row', { hasText: 'Potted plant' }).first()).toBeVisible();
  expect(page.url()).not.toContain('space=');

  await spaceButton(page, 'Store').click();
  await pressed(page, 'Store');
  expect(await saved(page, storeKey)).toEqual(store);
  await page.reload();
  await pressed(page, 'Store');
  await expect.poll(async () => (await saved(page, storeKey)).id).toBe(store.id);
  await page.goto('/');
  await pressed(page, 'Store');
  expect(errors).toEqual([]);
});

test('a preset store walkthrough plays and saves the layout', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?space=retail', storeKey);
  await layoutButton(page, 'Open event').click();
  await expect(page.getByRole('heading', { name: 'Classic boutique → Open event', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause layout walkthrough', exact: true }).click();
  await page.getByRole('button', { name: 'Skip to layout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Layout ready', exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page, storeKey)).activeLayoutId).toBe('open-event');
  await page.getByRole('button', { name: 'Close layout walkthrough', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Describe what you want from this store', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Back to the original', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('switching ends an open walkthrough, and a late agent reply cannot reach the other space', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?space=retail', storeKey);
  await layoutButton(page, 'Open event').click();
  await page.getByRole('button', { name: 'Pause layout walkthrough', exact: true }).click();
  await spaceButton(page, 'Bedroom').click();
  await pressed(page, 'Bedroom');
  await expect(page.locator('.layout-explainer')).toHaveCount(0);
  await expect.poll(async () => (await saved(page, storeKey)).activeLayoutId).toBe('original');

  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/layout-agent', async route => {
    await held;
    await route.fulfill({ json: { action: 'use_layout', layoutId: 'open-event', reply: 'Showing Open event.', provider: 'test', model: 'test', elapsedMs: 900 } }).catch(() => undefined);
  });
  await spaceButton(page, 'Store').click();
  await pressed(page, 'Store');
  const prompt = page.getByRole('textbox', { name: 'Describe what you want from this store', exact: true });
  await prompt.fill('make room for an event');
  await page.getByRole('button', { name: 'Rearrange the store', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop the store agent', exact: true })).toBeVisible();
  await spaceButton(page, 'Bedroom').click();
  await pressed(page, 'Bedroom');
  await expect(page.getByRole('button', { name: 'Stop the room agent', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Describe what you want from this room', exact: true })).toHaveValue('');
  release();
  await page.waitForTimeout(300);
  await expect(page.locator('.lp-reply')).toHaveCount(0);
  await expect(page.locator('.layout-explainer')).toHaveCount(0);
  expect((await saved(page, roomKey)).activeLayoutId).toBe('original');
  expect((await saved(page, storeKey)).activeLayoutId).toBe('original');
  expect(errors).toEqual([]);
});

test('a store project file opened in the bedroom lands in the store and leaves the bedroom alone', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?space=retail', storeKey);
  const file = await saved(page, storeKey);
  await spaceButton(page, 'Bedroom').click();
  await pressed(page, 'Bedroom');
  await expect.poll(() => page.evaluate(k => localStorage.getItem(k), roomKey)).not.toBeNull();
  const bedroom = await saved(page, roomKey);
  await page.locator('input[type=file][accept*=json]').setInputFiles({
    name: 'demo-store.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...file, name: 'Imported flagship' })),
  });
  await pressed(page, 'Store');
  await expect(page.locator('.breadcrumb')).toContainText('Imported flagship');
  await expect.poll(async () => (await saved(page, storeKey)).name).toBe('Imported flagship');
  expect(await saved(page, roomKey)).toEqual(bedroom);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.breadcrumb')).toContainText('Experiential store');
  expect(errors).toEqual([]);
});

/** Makes this page's localStorage refuse writes while `full` is set, as a full disk quota does. */
const fillable = (page: Page) => page.addInitScript(() => {
  const write = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key: string, value: string) {
    if (this === localStorage && sessionStorage.getItem('full') === '1') throw new DOMException('Full', 'QuotaExceededError');
    write.call(this, key, value);
  };
});
const setFull = (page: Page, full: boolean) => page.evaluate(f => { if (f) sessionStorage.setItem('full', '1'); else sessionStorage.removeItem('full'); }, full);

test('a tab follows a newer save instead of overwriting it on a switch or a later edit', async ({ context }) => {
  const stale = await context.newPage(), fresh = await context.newPage(), errors = watchErrors(stale);
  await open(stale, '/?space=retail', storeKey);
  await open(fresh, '/?space=retail', storeKey);
  const base = (await itemNames(fresh, storeKey)).filter(n => n === 'Lounge bench').length;
  await add(fresh, 'Hero plinth');
  await expect.poll(async () => (await itemNames(fresh, storeKey)).filter(n => n === 'Hero plinth').length).toBe(1);
  await expect(stale.getByRole('button', { name: 'Select Hero plinth', exact: true })).toBeVisible();
  await expect(stale.locator('.toast')).toContainText('another tab');
  await spaceButton(stale, 'Bedroom').click();
  await pressed(stale, 'Bedroom');
  expect(await itemNames(fresh, storeKey)).toContain('Hero plinth');

  await add(fresh, 'Lounge bench');
  await expect.poll(async () => (await itemNames(fresh, storeKey)).filter(n => n === 'Lounge bench').length).toBe(base + 1);
  await spaceButton(stale, 'Store').click();
  await pressed(stale, 'Store');
  await expect(stale.getByRole('button', { name: 'Select Lounge bench', exact: true }).nth(base)).toBeVisible();
  await add(stale, 'Potted plant');
  await expect.poll(async () => (await itemNames(stale, storeKey)).includes('Potted plant')).toBe(true);
  expect(await itemNames(stale, storeKey)).toEqual(expect.arrayContaining(['Hero plinth', 'Lounge bench']));
  expect(errors).toEqual([]);
});

test('unsaved work meeting a newer save asks which version to keep', async ({ context }) => {
  const mine = await context.newPage(), theirs = await context.newPage();
  await fillable(mine);
  await open(mine, '/?space=retail', storeKey);
  await open(theirs, '/?space=retail', storeKey);
  const base = (await itemNames(mine, storeKey)).filter(n => n === 'Lounge bench').length;
  const dialog = mine.getByRole('alertdialog', { name: 'Changed in another tab' });

  await setFull(mine, true);
  await add(mine, 'Lounge bench');
  await expect(mine.locator('.save-status')).toHaveText('Not saved');
  await add(theirs, 'Hero plinth');
  await expect(dialog).toBeVisible();
  await setFull(mine, false);
  await mine.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Load the newer version', exact: true }).click();
  await expect(mine.getByRole('button', { name: 'Select Hero plinth', exact: true })).toBeVisible();
  await expect(mine.getByRole('button', { name: 'Select Lounge bench', exact: true }).nth(base)).toHaveCount(0);
  await expect(mine.locator('.save-status')).toHaveText('Saved on this device');

  await setFull(mine, true);
  await add(mine, 'Lounge bench');
  await expect(mine.locator('.save-status')).toHaveText('Not saved');
  await add(theirs, 'Small stool');
  await expect(dialog).toBeVisible();
  await setFull(mine, false);
  await dialog.getByRole('button', { name: 'Keep my changes', exact: true }).click();
  await expect.poll(async () => (await itemNames(theirs, storeKey)).filter(n => n === 'Lounge bench').length).toBe(base + 1);
  await expect(theirs.getByRole('button', { name: 'Select Lounge bench', exact: true }).nth(base)).toBeVisible();
});

test('a full browser store never traps you in a space, even after a reload', async ({ page }) => {
  await fillable(page);
  await open(page, '/?space=retail', storeKey);
  const base = (await itemNames(page, storeKey)).filter(n => n === 'Lounge bench').length;
  const dialog = page.getByRole('alertdialog', { name: 'Changes not saved' });

  await setFull(page, true);
  await spaceButton(page, 'Bedroom').click();
  await pressed(page, 'Bedroom');
  await spaceButton(page, 'Store').click();
  await pressed(page, 'Store');
  await expect(dialog).toHaveCount(0);

  await add(page, 'Lounge bench');
  await spaceButton(page, 'Bedroom').click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay here', exact: true }).click();
  await pressed(page, 'Store');
  await spaceButton(page, 'Bedroom').click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export project', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('roomshift-project.json');
  await dialog.getByRole('button', { name: 'Switch anyway', exact: true }).click();
  await pressed(page, 'Bedroom');
  await spaceButton(page, 'Store').click();
  await pressed(page, 'Store');
  await expect(page.getByRole('button', { name: 'Select Lounge bench', exact: true }).nth(base)).toBeVisible();

  await page.evaluate(k => localStorage.removeItem(k), storeKey);
  await page.reload();
  await pressed(page, 'Store');
  await expect(page.locator('canvas')).toBeVisible();
  await spaceButton(page, 'Bedroom').click();
  await pressed(page, 'Bedroom');
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await pressed(page, 'Bedroom');
});

for (const [space, key, path] of [['Store', storeKey, '/?space=retail'], ['Bedroom', roomKey, '/?space=room']] as const) {
  test(`unreadable ${space} data is kept aside and reported`, async ({ page }) => {
    await open(page, path, key);
    await page.evaluate(k => localStorage.setItem(k, '{"version":1,"cut off'), key);
    await page.reload();
    await expect(page.locator('.toast')).toContainText(`${key}.corrupt`);
    expect(await page.evaluate(k => localStorage.getItem(`${k}.corrupt`), key)).toBe('{"version":1,"cut off');
    await expect.poll(async () => (await saved(page, key).catch(() => null))?.version).toBe(1);
  });
}

test('undo survives switching away and back, and a draft is not dropped unasked', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?space=retail', storeKey);
  await add(page, 'Hero plinth');
  await spaceButton(page, 'Bedroom').click();
  await pressed(page, 'Bedroom');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await spaceButton(page, 'Store').click();
  await pressed(page, 'Store');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Hero plinth', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select Hero plinth', exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: 'Select Hero plinth', exact: true }).click();
  await page.getByRole('button', { name: 'Replace this piece', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Leave this replacement' });
  await spaceButton(page, 'Bedroom').click();
  await dialog.getByRole('button', { name: 'Stay here', exact: true }).click();
  await pressed(page, 'Store');
  await expect(page.getByRole('heading', { name: 'Try a different piece.', exact: true })).toBeVisible();
  await spaceButton(page, 'Bedroom').click();
  await dialog.getByRole('button', { name: 'Discard and switch', exact: true }).click();
  await pressed(page, 'Bedroom');
  await expect(page.getByRole('heading', { name: 'Try a different piece.', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a store fixture is only ever offered store pieces', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, '/?space=retail', storeKey);
  await add(page, 'Hero plinth');
  await page.getByRole('button', { name: 'Replace this piece', exact: true }).click();
  await expect(page.getByText('No store alternatives yet', { exact: true })).toBeVisible();
  const category = page.locator('#replacement-category');
  const kinds = await category.locator('option').allTextContents();
  expect(kinds.filter(k => /bed|wardrobe|desk|fan/.test(k))).toEqual([]);
  await category.selectOption('chair');
  await expect(page.getByText('No store alternatives yet', { exact: true })).toHaveCount(0);
  await expect(page.locator('.replacement-catalog button').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('store cards show a stone floor and new pieces land on free floor', async ({ page }) => {
  await open(page, '/?space=retail', storeKey);
  await expect(page.locator('.mini-plan-inner.store-floor').first()).toBeVisible();
  await add(page, 'Display table');
  await add(page, 'Display table');
  await add(page, 'Display table');
  await expect.poll(async () => (await itemNames(page, storeKey)).filter(n => n === 'Display table').length).toBeGreaterThanOrEqual(3);
  const project = await saved(page, storeKey);
  const items = project.layouts.find((l: { id: string }) => l.id === project.activeLayoutId).items;
  const added = items.slice(-3).map((i: { position: { x: number; z: number } }) => `${i.position.x},${i.position.z}`);
  expect(new Set(added).size).toBe(3);
  await page.goto('/?space=room');
  await expect(page.locator('.mini-plan-inner.store-floor')).toHaveCount(0);
  await expect(page.locator('.mini-plan-inner').first()).toBeVisible();
});

test('the store speaks of stores and fixtures throughout', async ({ page }) => {
  await open(page, '/?space=retail', storeKey);
  await expect(page.locator('.structure-card')).not.toContainText('windows');
  await page.getByRole('button', { name: 'Navigation help', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Navigation help' });
  await expect(help).toContainText('Fixtures block your path');
  await expect(help).not.toContainText('Make yourself at home');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Cost & time', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Usage room scope' }).locator('option')).toHaveText([/^This store ·/, 'All my spaces']);
  await page.getByRole('button', { name: 'Close cost and time', exact: true }).click();
  await page.getByRole('button', { name: 'Add fixtures', exact: false }).click();
  await page.getByRole('button', { name: /Try a product link/ }).click();
  await expect(page.getByRole('heading', { name: 'Try a product in your store.', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Your product, in your store');
});
