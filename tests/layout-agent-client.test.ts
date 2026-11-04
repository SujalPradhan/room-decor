import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/domain';
import { askLayoutAgent, inlineChecks, LayoutAgentHttpError, readLayoutAgentResult, workerChecks, type LayoutChecks } from '../src/layout-agent-client';
import { CALL_SHARE_MS, CALL_WINDOW_MS, DEADLINE_MS } from '../src/layout-agent-core';

const project = createInitialProject(), meta = { reply: 'Done.', provider: 'p', model: 'm', attempts: 1, elapsedMs: 1 };
const layout = { ...structuredClone(project.layouts[0]), id: 'agent-1', wallColor: '#112233' };
describe('agent reply validation', () => {
  it('accepts valid replies', () => {
    expect(readLayoutAgentResult({ ...meta, action: 'decline' }, project).action).toBe('decline');
    expect(readLayoutAgentResult({ ...meta, action: 'use_layout', layoutId: 'open-airy' }, project).action).toBe('use_layout');
    expect(readLayoutAgentResult({ ...meta, action: 'rearrange', layout, reasons: {} }, project).action).toBe('rearrange');
  });
  it.each([
    ['empty', {}], ['array', []], ['text', 'hi'], ['object reply', { ...meta, reply: { a: 1 }, action: 'decline' }],
    ['unknown action', { ...meta, action: 'dance' }], ['unknown layout', { ...meta, action: 'use_layout', layoutId: 'nope' }],
    ['bad reasons', { ...meta, action: 'rearrange', layout, reasons: { a: 1 } }], ['junk layout', { ...meta, action: 'rearrange', layout: { id: 'x' }, reasons: {} }],
    ['no-op', { ...meta, action: 'rearrange', layout: { ...layout, wallColor: project.layouts[0].wallColor }, reasons: {} }],
    ['duplicate id', { ...meta, action: 'rearrange', layout: { ...layout, id: 'open-airy' }, reasons: {} }],
  ])('rejects %s', (_name, value) => { expect(() => readLayoutAgentResult(value, project)).toThrow(); });
});

/** The browser loop against a mocked endpoint. */
const proposal = (extra: object) => ({ action: 'rearrange', goal: 'other', layoutId: '', name: 'Tucked', description: 'Stool tucked', reply: 'Moved it.', moves: [], removals: [], recolors: [], additions: [], wallColor: '', accentColor: '', colorReason: '', ...extra });
const good = proposal({ moves: [{ itemId: 'stool', x: .2, z: -2.1, rotationDegrees: 0, reason: 'Out of the way.' }] });
const bad = proposal({ moves: [{ itemId: 'sofa', x: 0, z: 0, rotationDegrees: 0, reason: 'Nope.' }] });
const answer = (value: object, provider = 'LLM Foundry') => Response.json({ proposal: value, provider, model: 'gemini-test' });
type Reply = Response | ((signal: AbortSignal) => Promise<Response>);
function endpoint(...replies: Reply[]) {
  const bodies: Record<string, any>[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/layout-agent');
    bodies.push(JSON.parse(String(init.body)));
    const next = replies.shift();
    if (!next) throw new Error('no reply');
    return typeof next === 'function' ? next(init.signal!) : next;
  }) as unknown as typeof fetch;
  return { fetcher, bodies };
}
const hang = (signal: AbortSignal) => new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));

describe('browser agent loop', () => {
  it('sends the compact situation, never the project', async () => {
    const { fetcher, bodies } = endpoint(answer(good));
    const result = await askLayoutAgent('tuck the stool', project, { fetcher, checks: inlineChecks() });
    expect(result).toMatchObject({ action: 'rearrange', attempts: 1, provider: 'LLM Foundry', model: 'gemini-test', reasons: { stool: 'Out of the way.' } });
    expect(Object.keys(bodies[0]).sort()).toEqual(['request', 'situation']);
    expect(bodies[0].situation).toMatchObject({ space: 'room', activeLayout: 'Original', furniture: expect.any(Array), savedLayouts: expect.any(Array) });
    expect(bodies[0].situation.savedLayouts[0].largestOpenFloorM2).toBeGreaterThan(0);
    expect(() => readLayoutAgentResult(result, project)).not.toThrow();
  });
  it('retries with the problems the checks found', async () => {
    const { fetcher, bodies } = endpoint(answer(bad), answer(good));
    const attempts: number[] = [];
    expect(await askLayoutAgent('move the stool', project, { fetcher, checks: inlineChecks(), onAttempt: attempt => attempts.push(attempt) })).toMatchObject({ action: 'rearrange', attempts: 2 });
    expect(bodies[1].previous).toEqual({ proposal: bad, problems: ['Unknown piece "sofa".'] });
    expect(attempts).toEqual([1, 2]);
  });
  it('asks for valid JSON after an unreadable model reply', async () => {
    const { fetcher, bodies } = endpoint(Response.json({ error: { code: 'LAYOUT_AGENT_BAD_REPLY' } }, { status: 502 }), answer(good));
    expect(await askLayoutAgent('tuck the stool', project, { fetcher, checks: inlineChecks() })).toMatchObject({ action: 'rearrange', attempts: 2 });
    expect(bodies[1].previous).toEqual({ proposal: null, problems: ['The previous response was not valid JSON.'] });
  });
  it('reports the provider the server failed over to', async () => {
    const { fetcher } = endpoint(answer(good, 'AI Pipe'));
    expect(await askLayoutAgent('tuck the stool', project, { fetcher, checks: inlineChecks() })).toMatchObject({ provider: 'AI Pipe' });
  });
  it('asks for the backup provider first only after it has answered once', async () => {
    const { fetcher, bodies } = endpoint(answer(bad), answer(bad, 'AI Pipe'), answer(good, 'AI Pipe'));
    await askLayoutAgent('move the stool', project, { fetcher, checks: inlineChecks() });
    expect(bodies.map(body => body.preferBackup)).toEqual([undefined, undefined, true]);
  });
  it('stops between attempts and makes no further call', async () => {
    const { fetcher, bodies } = endpoint(answer(bad), answer(good));
    const controller = new AbortController(), inline = inlineChecks();
    const checks: LayoutChecks = { ...inline, judge: async (...args) => { const verdict = await inline.judge(...args); controller.abort(); return verdict; } };
    await expect(askLayoutAgent('move the stool', project, { fetcher, checks, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(bodies).toHaveLength(1);
  });
  it('stops a call in flight', async () => {
    const controller = new AbortController(), { fetcher, bodies } = endpoint(hang, answer(good));
    const asked = askLayoutAgent('move the stool', project, { fetcher, checks: inlineChecks(), signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(asked).rejects.toMatchObject({ name: 'AbortError' });
    expect(bodies).toHaveLength(1);
  });
  it('gives up at the deadline, with the last problems when there are some', async () => {
    const first = endpoint(hang);
    await expect(askLayoutAgent('move the stool', project, { fetcher: first.fetcher, checks: inlineChecks(), deadlineMs: 50, callWindowMs: 0 })).rejects.toBeDefined();
    const second = endpoint(answer(bad), hang);
    const result = await askLayoutAgent('move the stool', project, { fetcher: second.fetcher, checks: inlineChecks(), deadlineMs: 150, callWindowMs: 0 });
    expect(result).toMatchObject({ action: 'decline', reply: 'I could not find an arrangement that passes the room checks. Unknown piece "sofa".' });
    expect(result.elapsedMs).toBeLessThan(1000);
    const late = endpoint(answer(bad), answer(good));
    expect(await askLayoutAgent('move the stool', project, { fetcher: late.fetcher, checks: inlineChecks(), deadlineMs: 60_000, callWindowMs: 60_000 })).toMatchObject({ action: 'decline', attempts: 1 });
    expect(late.bodies).toHaveLength(0);
  });
  it('cuts a hung call off at its share of the deadline, leaving time to answer', async () => {
    const { fetcher, bodies } = endpoint(answer(bad), hang);
    const began = Date.now(), result = await askLayoutAgent('move the stool', project, { fetcher, checks: inlineChecks(), deadlineMs: 5_000, callShareMs: 100, callWindowMs: 0 });
    expect(result).toMatchObject({ action: 'decline', attempts: 2 });
    expect(Date.now() - began).toBeLessThan(1_000);
    expect(bodies).toHaveLength(2);
  });
  it('gives the whole request 30 s, each call at most 18 s, and no new try with under 8 s left', () => {
    expect([DEADLINE_MS, CALL_SHARE_MS, CALL_WINDOW_MS]).toEqual([30_000, 18_000, 8_000]);
  });
  it('hands a busy or failing endpoint back to the app mid-request, instead of a technical decline', async () => {
    for (const status of [429, 502, 503]) {
      const { fetcher, bodies } = endpoint(answer(bad), Response.json({ error: { code: 'X' } }, { status }));
      await expect(askLayoutAgent('move the stool', project, { fetcher, checks: inlineChecks() })).rejects.toMatchObject({ name: 'LayoutAgentHttpError', status });
      expect(bodies).toHaveLength(2);
    }
  });
  it('surfaces endpoint errors so the app can fall back to its rules', async () => {
    for (const status of [400, 429, 503]) {
      const { fetcher } = endpoint(Response.json({ error: { code: 'X' } }, { status }));
      await expect(askLayoutAgent('x', project, { fetcher, checks: inlineChecks() })).rejects.toBeInstanceOf(LayoutAgentHttpError);
    }
    for (const body of [{}, { proposal: { action: 'decline', reply: { a: 1 } }, provider: 'p', model: 'm' }, { proposal: good, provider: 5, model: 'm' }]) {
      const { fetcher } = endpoint(Response.json(body));
      await expect(askLayoutAgent('x', project, { fetcher, checks: inlineChecks() })).rejects.toThrow();
    }
  });
  it('runs the checks inline where Worker is unavailable', async () => {
    expect(typeof Worker).toBe('undefined');
    const { fetcher } = endpoint(answer(good));
    expect(await askLayoutAgent('tuck the stool', project, { fetcher, checks: workerChecks() })).toMatchObject({ action: 'rearrange' });
  });
});
