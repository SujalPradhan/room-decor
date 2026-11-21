import { describe, expect, it, vi } from 'vitest';
import { CODE_RE, GUEST_RATE, HOST_RATE, MAX_BYTES, originAllowed, parseClientMessage, peersOf, relay, routeTowerRoom, sameSecret, takeToken, type Attachment } from '../server/tower-room';
import { followCodeFromUrl, makeCode, makeSecret, shareLink, throttle } from '../src/tower/tower-share';

const pose = { p: [1, 2, 3], t: [0, 0, 0] };
const state = { mode: 'tower', floor: 4, unitId: '4A', furnish: null, key: 'tower-4A' };
const host: Attachment = { id: 'h1', role: 'host', label: 'Host', exploring: false };
const guest: Attachment = { id: 'g1', role: 'guest', label: 'Guest 1', exploring: false };

describe('message validation', () => {
  it('accepts host state and pose, guest pose', () => {
    expect(parseClientMessage('host', JSON.stringify({ t: 'state', state })).ok).toBe(true);
    expect(parseClientMessage('host', JSON.stringify({ t: 'pose', pose })).ok).toBe(true);
    expect(parseClientMessage('guest', JSON.stringify({ t: 'pose', pose, exploring: true })).ok).toBe(true);
  });
  it('rejects a guest state message and a guest pose without exploring', () => {
    expect(parseClientMessage('guest', JSON.stringify({ t: 'state', state }))).toMatchObject({ ok: false });
    expect(parseClientMessage('guest', JSON.stringify({ t: 'pose', pose }))).toMatchObject({ ok: false });
  });
  it('rejects bad shapes, non-finite and extra fields, junk and binary', () => {
    const bad = [
      { t: 'pose', pose: { p: [1, 2], t: [0, 0, 0] } },
      { t: 'pose', pose: { p: [1, 2, 'x'], t: [0, 0, 0] } },
      { t: 'pose', pose: { p: [1e9, 0, 0], t: [0, 0, 0] } },
      { t: 'pose', pose, extra: 1 },
      { t: 'state', state: { ...state, mode: 'roof' } },
      { t: 'state', state: { ...state, floor: 2.5 } },
      { t: 'state', state: { ...state, extra: 1 } },
      { t: 'state', state: { ...state, furnish: { unitId: 'x' } } },
      { t: 'nope' }, null, 5, [],
    ];
    for (const m of bad) expect(parseClientMessage('host', JSON.stringify(m)).ok).toBe(false);
    expect(parseClientMessage('host', '{not json')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseClientMessage('host', new ArrayBuffer(4))).toEqual({ ok: false, reason: 'not-text' });
  });
  it('rejects NaN smuggled as null and oversized messages', () => {
    expect(parseClientMessage('host', '{"t":"pose","pose":{"p":[null,0,0],"t":[0,0,0]}}').ok).toBe(false);
    const big = JSON.stringify({ t: 'state', state: { ...state, key: 'x'.repeat(MAX_BYTES) } });
    expect(parseClientMessage('host', big)).toEqual({ ok: false, reason: 'too-large' });
    const multibyte = '{"pad":"' + 'é'.repeat(MAX_BYTES / 2 + 10) + '"}';
    expect(multibyte.length).toBeLessThan(MAX_BYTES);
    expect(parseClientMessage('host', multibyte)).toEqual({ ok: false, reason: 'too-large' });
  });
});

describe('rate limit', () => {
  it('allows the burst then throttles, and refills over time', () => {
    let bucket; let allowed = 0;
    for (let i = 0; i < 100; i++) { const r = takeToken(bucket, 1000, HOST_RATE); bucket = r.bucket; if (r.allowed) allowed++; }
    expect(allowed).toBe(HOST_RATE);
    expect(takeToken(bucket, 1000, HOST_RATE).allowed).toBe(false);
    expect(takeToken(bucket, 1000 + 1000 / HOST_RATE + 5, HOST_RATE).allowed).toBe(true);
    let g; let n = 0;
    for (let i = 0; i < 50; i++) { const r = takeToken(g, 0, GUEST_RATE); g = r.bucket; if (r.allowed) n++; }
    expect(n).toBe(GUEST_RATE);
  });
  it('never exceeds the burst after a long idle', () => {
    const idle = takeToken({ tokens: 0, at: 0 }, 3_600_000, GUEST_RATE);
    expect(idle.bucket.tokens).toBeLessThanOrEqual(GUEST_RATE);
  });
});

describe('relay', () => {
  it('relays host state to guests and stores it', () => {
    const msg = parseClientMessage('host', JSON.stringify({ t: 'state', state }));
    if (!msg.ok) throw new Error('parse');
    expect(relay(host, msg.msg)).toMatchObject({ to: 'guests', message: { t: 'state' }, store: { state: { unitId: '4A' } } });
  });
  it('relays host pose to guests without storing and guest pose only to the host', () => {
    const h = parseClientMessage('host', JSON.stringify({ t: 'pose', pose }));
    const g = parseClientMessage('guest', JSON.stringify({ t: 'pose', pose, exploring: true }));
    if (!h.ok || !g.ok) throw new Error('parse');
    expect(relay(host, h.msg)).toEqual({ to: 'guests', message: { t: 'pose', from: 'h1', role: 'host', pose } });
    expect(relay(guest, g.msg)).toEqual({ to: 'host', message: { t: 'pose', from: 'g1', role: 'guest', pose, exploring: true } });
  });
  it('lists peers without attachment internals', () => {
    expect(peersOf([{ ...host, pose: pose as never }, guest])).toEqual([{ id: 'h1', role: 'host', label: 'Host' }, { id: 'g1', role: 'guest', label: 'Guest 1' }]);
  });
});

describe('origin and codes', () => {
  it('matches the request host and allows localhost aliases in dev only', () => {
    expect(originAllowed('https://roomshift.example', 'https://roomshift.example/api/tower-room/abc')).toBe(true);
    expect(originAllowed('https://evil.example', 'https://roomshift.example/api/x')).toBe(false);
    expect(originAllowed(null, 'https://roomshift.example/api/x')).toBe(false);
    expect(originAllowed('not a url', 'https://roomshift.example/api/x')).toBe(false);
    expect(originAllowed('http://localhost:5173', 'http://127.0.0.1:5173/api/x')).toBe(true);
    expect(originAllowed('http://localhost:9999', 'http://127.0.0.1:5173/api/x')).toBe(false);
    expect(originAllowed('http://localhost:5173', 'https://roomshift.example/api/x')).toBe(false);
  });
  it('generates valid codes and secrets', () => {
    for (let i = 0; i < 50; i++) { expect(CODE_RE.test(makeCode())).toBe(true); expect(makeSecret()).toMatch(/^[A-Za-z0-9]{32}$/); }
    expect(new Set(Array.from({ length: 50 }, makeCode)).size).toBe(50);
    expect(followCodeFromUrl('?follow=abcdefghij')).toBe('abcdefghij');
    for (const bad of ['?follow=ABCDEFGHIJ', '?follow=short', '?follow=abcdefghijk', '?follow=', '']) expect(followCodeFromUrl(bad)).toBeNull();
    expect(shareLink('https://x.test', 'abcdefghij')).toBe('https://x.test/tower?follow=abcdefghij');
  });
  it('compares secrets exactly', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
  });
});

describe('worker routing', () => {
  const forwarded: Request[] = [];
  const env = { TOWER_ROOM: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => { forwarded.push(r); return new Response('ok'); } }) } };
  const ws = (path: string, init: { origin?: string | null; upgrade?: boolean; method?: string } = {}) => {
    const headers = new Headers();
    if (init.upgrade !== false) headers.set('Upgrade', 'websocket');
    if (init.origin !== null) headers.set('Origin', init.origin ?? 'https://site.test');
    return new Request(`https://site.test${path}`, { method: init.method ?? 'GET', headers });
  };
  const secret = 'S'.repeat(20);
  it('ignores other paths', async () => { expect(await routeTowerRoom(new Request('https://site.test/tower'), env)).toBeNull(); });
  it('rejects missing upgrade, bad method, bad code, bad origin, bad role and short secret', async () => {
    expect((await routeTowerRoom(ws('/api/tower-room/abcdefghij?role=guest', { upgrade: false }), env))?.status).toBe(426);
    expect((await routeTowerRoom(ws('/api/tower-room/abcdefghij?role=guest', { method: 'POST' }), env))?.status).toBe(405);
    for (const code of ['short', 'ABCDEFGHIJ', 'abcdefghijk', '..%2f..%2fx', 'abc-defghi']) expect((await routeTowerRoom(ws(`/api/tower-room/${code}?role=guest`), env))?.status).toBe(404);
    expect((await routeTowerRoom(ws('/api/tower-room/abcdefghij?role=guest', { origin: 'https://evil.test' }), env))?.status).toBe(403);
    expect((await routeTowerRoom(ws('/api/tower-room/abcdefghij?role=guest', { origin: null }), env))?.status).toBe(403);
    expect((await routeTowerRoom(ws('/api/tower-room/abcdefghij?role=admin'), env))?.status).toBe(400);
    expect((await routeTowerRoom(ws('/api/tower-room/abcdefghij?role=host&secret=short'), env))?.status).toBe(400);
    expect((await routeTowerRoom(ws('/api/tower-room/abcdefghij?role=guest'), {}))?.status).toBe(503);
    expect(forwarded).toHaveLength(0);
  });
  it('forwards valid host and guest requests to the room', async () => {
    expect((await routeTowerRoom(ws(`/api/tower-room/abcdefghij?role=host&secret=${secret}`), env))?.status).toBe(200);
    expect((await routeTowerRoom(ws('/api/tower-room/abcdefghij?role=guest'), env))?.status).toBe(200);
    expect(forwarded).toHaveLength(2);
  });
});

describe('throttle', () => {
  it('sends the first call, then at most one per interval, ending on the latest', () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const t = throttle((n: number) => sent.push(n), 100);
    t(1); t(2); t(3);
    expect(sent).toEqual([1]);
    vi.advanceTimersByTime(100);
    expect(sent).toEqual([1, 3]);
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([1, 3]);
    vi.useRealTimers();
  });
});
