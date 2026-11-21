import { test, expect as baseExpect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import http from 'node:http';

const expect = baseExpect.configure({ timeout: 40_000 });
const BASE = process.env.ROOMSHIFT_BASE_URL ?? 'http://127.0.0.1:5173';

function watchErrors(page: Page, ignore: RegExp[] = []) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('503') && !ignore.some(r => r.test(message.text()))) errors.push(message.text()); });
  return errors;
}

async function open(browser: Browser, url: string) {
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 } });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await page.goto(url);
  return { context, page, errors };
}

async function startShare(page: Page) {
  await page.getByRole('button', { name: 'Share tour' }).click();
  const link = await page.getByRole('textbox', { name: 'Share link' }).inputValue();
  expect(link).toMatch(/\/tower\?follow=[a-z0-9]{10}$/);
  await expect(page.getByRole('region', { name: 'Share tour' }).getByText('0 guests')).toBeVisible();
  return link;
}

async function pickAndFlyIn(page: Page, floor = 12) {
  await page.getByRole('button', { name: new RegExp(`^Floor ${floor},`) }).click();
  await page.getByRole('region', { name: `Floor ${floor} units` }).locator('.tower-unit').first().click();
  await page.getByRole('region', { name: /^Unit \d/ }).getByRole('button', { name: 'Fly in' }).click();
  await expect(page.getByRole('button', { name: 'Back to tower' })).toBeVisible();
}

const crumb = (page: Page) => page.locator('.tower-crumb');
const banner = (page: Page) => page.getByRole('region', { name: 'Guest tour' });

/** Resolves the HTTP status, or 0 when the dev proxy drops a refused upgrade without a response. */
function upgrade(path: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const url = new URL(path, BASE);
    const req = http.request({ host: url.hostname, port: url.port, path: url.pathname + url.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0); });
    req.on('response', res => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on('error', () => resolve(0));
    req.end();
  });
}

interface Probe { opened: boolean; closeCode: number | null; messages: string[] }
async function probe(page: Page, query: string, code: string, send?: string[], wait = 800): Promise<Probe> {
  return page.evaluate(([q, c, frames, ms]) => new Promise<Probe>(resolve => {
    const out: Probe = { opened: false, closeCode: null, messages: [] };
    const ws = new WebSocket(`ws://${location.host}/api/tower-room/${c}?${q}`);
    ws.onopen = () => { out.opened = true; for (const f of frames ?? []) ws.send(f); };
    ws.onmessage = e => out.messages.push(String(e.data));
    ws.onclose = e => { out.closeCode = e.code; resolve(out); };
    setTimeout(() => { if (out.closeCode === null) { ws.close(); setTimeout(() => resolve(out), 100); } }, ms);
  }), [query, code, send ?? null, wait] as const);
}

test.describe.configure({ mode: 'serial' });

test('host shares, guest follows, late joiner gets current state', async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await open(browser, '/tower');
  const link = await startShare(host.page);
  const guest = await open(browser, link);
  await expect(banner(guest.page)).toContainText('Following the host');
  await expect(host.page.getByRole('region', { name: 'Share tour' }).getByText('1 guest')).toBeVisible();
  await expect(guest.page.getByRole('button', { name: 'Share tour' })).toHaveCount(0);
  await expect(guest.page.locator('.tower-rail button').first()).toBeDisabled();

  await pickAndFlyIn(host.page);
  const label = (await crumb(host.page).textContent())!;
  await expect(crumb(guest.page)).toHaveText(label);
  await expect(guest.page.getByRole('form')).toHaveCount(0);

  const late = await open(browser, link);
  await expect(crumb(late.page)).toHaveText(label, { timeout: 60_000 });
  await expect(host.page.getByRole('region', { name: 'Share tour' }).getByText('2 guests')).toBeVisible();

  await host.page.getByRole('button', { name: 'Back to tower' }).click();
  await expect(guest.page.getByRole('navigation', { name: 'Floors' })).toBeVisible();
  await expect(late.page.getByRole('navigation', { name: 'Floors' })).toBeVisible();

  for (const p of [host, guest, late]) expect(p.errors).toEqual([]);
  expect(await guest.page.evaluate(() => localStorage.getItem('roomshift-tower-v1'))).toBeNull();
  await Promise.all([host, guest, late].map(p => p.context.close()));
});

test('guest explores on their own, then snaps back to the host', async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await open(browser, '/tower');
  const link = await startShare(host.page);
  const guest = await open(browser, link);
  await expect(banner(guest.page)).toContainText('Following the host');
  await pickAndFlyIn(host.page, 12);
  const hostLabel = (await crumb(host.page).textContent())!;
  await expect(crumb(guest.page)).toHaveText(hostLabel);

  await guest.page.getByRole('button', { name: 'Explore on my own' }).click();
  await expect(banner(guest.page)).toContainText('Exploring on your own');
  await expect(guest.page.getByRole('button', { name: 'Back to tower' })).toBeEnabled();

  await host.page.getByRole('button', { name: 'Back to tower' }).click();
  await expect(host.page.getByRole('navigation', { name: 'Floors' })).toBeVisible();
  await expect(guest.page.getByRole('button', { name: 'Back to tower' })).toBeVisible();
  await expect(crumb(guest.page)).toHaveText(hostLabel);

  await guest.page.getByRole('button', { name: 'Follow host' }).click();
  await expect(banner(guest.page)).toContainText('Following the host');
  await expect(guest.page.getByRole('navigation', { name: 'Floors' })).toBeVisible();
  await expect(guest.page.locator('.tower-rail button').first()).toBeDisabled();

  for (const p of [host, guest]) expect(p.errors).toEqual([]);
  await Promise.all([host, guest].map(p => p.context.close()));
});

test('guest keyboard moves send exploring poses', async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await open(browser, '/tower');
  const link = await startShare(host.page);
  const guest = await open(browser, link);
  const frames: string[] = [];
  guest.page.on('websocket', ws => ws.on('framesent', f => frames.push(String(f.payload))));
  await guest.page.reload();
  await expect(banner(guest.page)).toContainText('Following the host');
  await guest.page.getByRole('button', { name: 'Explore on my own' }).click();
  const scene = guest.page.locator('.tower-scene');
  await scene.focus();
  await guest.page.keyboard.down('ArrowLeft');
  await guest.page.waitForTimeout(700);
  await guest.page.keyboard.up('ArrowLeft');
  await guest.page.waitForTimeout(300);
  const poses = frames.map(f => { try { return JSON.parse(f); } catch { return null; } }).filter(m => m?.t === 'pose' && m.exploring === true);
  expect(poses.length).toBeGreaterThan(1);
  expect(new Set(poses.map(m => JSON.stringify(m.pose.p))).size).toBeGreaterThan(1);

  await Promise.all([host, guest].map(p => p.context.close()));
});

test('host camera moves reach a following guest', async ({ browser }) => {
  const host = await open(browser, '/tower');
  const link = await startShare(host.page);
  const guest = await open(browser, link);
  const received: string[] = [];
  guest.page.on('websocket', ws => ws.on('framereceived', f => received.push(String(f.payload))));
  await guest.page.reload();
  await expect(banner(guest.page)).toContainText('Following the host');
  const box = (await host.page.locator('.tower-scene').boundingBox())!;
  await host.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.page.mouse.down();
  await host.page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 40, { steps: 12 });
  await host.page.mouse.up();
  await expect.poll(() => received.filter(f => f.includes('"role":"host"') && f.includes('"t":"pose"')).length).toBeGreaterThan(0);
  await Promise.all([host, guest].map(p => p.context.close()));
});

test('guest sees the host leave and keeps exploring', async ({ browser }) => {
  test.setTimeout(240_000);
  const host = await open(browser, '/tower');
  const link = await startShare(host.page);
  const guest = await open(browser, link);
  await pickAndFlyIn(host.page);
  await expect(crumb(guest.page)).toBeVisible({ timeout: 60_000 });
  await host.page.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(banner(guest.page)).toContainText('Host left');
  await guest.page.getByRole('button', { name: 'Explore on my own' }).click();
  await guest.page.getByRole('button', { name: 'Back to tower' }).click();
  await expect(guest.page.getByRole('navigation', { name: 'Floors' })).toBeVisible();
  const late = await open(browser, link);
  await expect(banner(late.page)).toContainText('Host left');
  expect(guest.errors).toEqual([]);
  await Promise.all([host, guest, late].map(p => p.context.close()));
});

test('bad link, unknown room and server-side rejections', async ({ browser }) => {
  test.setTimeout(240_000);
  const bad = await open(browser, '/tower?follow=NOT-A-CODE');
  await expect(banner(bad.page)).toContainText('Could not join');
  await bad.page.getByRole('link', { name: 'Open Tower Lab' }).click();
  await expect(bad.page.getByRole('button', { name: 'Share tour' })).toBeVisible();

  const unknown = await browser.newContext();
  const ghost = await unknown.newPage();
  await ghost.goto('/tower?follow=zzzzzzzzzz');
  await expect(banner(ghost)).toContainText('Could not join', { timeout: 15_000 });

  const host = await open(browser, '/tower');
  const link = await startShare(host.page);
  const code = link.split('=')[1];
  const secret = await host.page.evaluate(() => JSON.parse(sessionStorage.getItem('roomshift-tower-host')!).secret as string);
  const origin = new URL(BASE).origin;

  expect(await upgrade(`/api/tower-room/${code}?role=guest`, { Origin: origin })).toBe(101);
  const refused = [
    upgrade(`/api/tower-room/${code}?role=guest`, { Origin: 'https://evil.example' }),
    upgrade(`/api/tower-room/${code}?role=guest`, {}),
    upgrade('/api/tower-room/BADCODE?role=guest', { Origin: origin }),
    upgrade(`/api/tower-room/${code}?role=host&secret=${'x'.repeat(24)}`, { Origin: origin }),
    upgrade(`/api/tower-room/${code}?role=host&secret=short`, { Origin: origin }),
    upgrade('/api/tower-room/qqqqqqqqqq?role=guest', { Origin: origin }),
  ];
  for (const status of await Promise.all(refused)) expect(status).not.toBe(101);
  const plain = await host.page.request.get(`/api/tower-room/${code}?role=guest`);
  expect(plain.status()).toBe(426);

  const wrong = await probe(host.page, `role=host&secret=${'y'.repeat(24)}`, code);
  expect(wrong.opened).toBe(false);

  const garbage = await probe(host.page, 'role=guest', code, ['{nope']);
  expect(garbage.opened).toBe(true);
  expect(garbage.closeCode).toBe(1008);
  const stateAsGuest = await probe(host.page, 'role=guest', code, [JSON.stringify({ t: 'state', state: { mode: 'tower', floor: null, unitId: null, furnish: null, key: 'x' } })]);
  expect(stateAsGuest.closeCode).toBe(1008);
  const oversize = await probe(host.page, 'role=guest', code, ['{"t":"pose","pad":"' + 'a'.repeat(40_000) + '"}']);
  expect(oversize.closeCode).toBe(1009);

  await expect(host.page.getByRole('region', { name: 'Share tour' }).getByText('0 guests')).toBeVisible();
  const hostSocket = await probe(host.page, `role=host&secret=${secret}`, code, [JSON.stringify({ t: 'pose', pose: { p: [0, 0, 0], t: [0, 1, 0] } })], 500);
  expect(hostSocket.opened).toBe(true);
  await Promise.all([bad.context.close(), unknown.close(), host.context.close()]);
});

test('layout fits at 1512 and 390 with no horizontal scroll', async ({ browser }) => {
  test.setTimeout(240_000);
  const sizes = [{ width: 1512, height: 900 }, { width: 390, height: 844 }];
  for (const size of sizes) {
    const hostCtx: BrowserContext = await browser.newContext({ viewport: size });
    const host = await hostCtx.newPage();
    await host.goto('/tower');
    const link = await startShare(host);
    const guestCtx = await browser.newContext({ viewport: size });
    const guest = await guestCtx.newPage();
    await guest.goto(link);
    await expect(banner(guest)).toContainText('Following the host');
    await expect(host.getByRole('region', { name: 'Share tour' }).getByText('1 guest')).toBeVisible();
    for (const page of [host, guest]) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await Promise.all([hostCtx.close(), guestCtx.close()]);
  }
});
