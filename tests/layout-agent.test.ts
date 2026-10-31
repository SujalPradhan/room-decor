import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/domain';
import { openFloorArea } from '../src/layout-explainer';
import { LayoutAgentError, runLayoutAgent } from '../server/layout-agent';

const base = { goal: 'other', layoutId: '', name: 'Quiet corner', description: 'Stool tucked away', reply: 'Moved it.' };
const gemini = (body: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }));
function sequence(...replies: (Response | Error)[]) {
  const calls: { url: string; body: string }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    const next = replies.shift();
    if (!next || next instanceof Error) throw next ?? new Error('no reply');
    return next;
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const moveStool = { ...base, action: 'rearrange', moves: [{ itemId: 'stool', x: .2, z: -2.1, rotationDegrees: 0, reason: 'Out of the way.' }] };
const onBed = { ...base, action: 'rearrange', moves: [{ itemId: 'stool', x: -.5, z: .05, rotationDegrees: 0, reason: 'Nope.' }] };

describe('room agent loop', () => {
  it('returns a checked arrangement with the reason for each move', async () => {
    const { fetcher } = sequence(gemini(moveStool));
    const result = await runLayoutAgent('tuck the stool away', createInitialProject(), { foundryToken: 'token' }, fetcher);
    expect(result).toMatchObject({ action: 'rearrange', attempts: 1, reasons: { stool: 'Out of the way.' }, provider: 'LLM Foundry' });
  });
  it('feeds rejected moves back and accepts the corrected proposal', async () => {
    const { fetcher, calls } = sequence(gemini(onBed), gemini(moveStool));
    const result = await runLayoutAgent('move the stool', createInitialProject(), { foundryToken: 'token' }, fetcher);
    expect(result).toMatchObject({ action: 'rearrange', attempts: 2 });
    expect(calls[1].body).toContain('rejected by the room checks');
  });
  it('declines after three failed attempts instead of returning an invalid room', async () => {
    const { fetcher, calls } = sequence(gemini(onBed), gemini(onBed), gemini(onBed));
    const result = await runLayoutAgent('move the stool', createInitialProject(), { foundryToken: 'token' }, fetcher);
    expect(result.action).toBe('decline');
    expect(calls).toHaveLength(3);
  });
  it('rejects locked pieces and unmeasured claims of more space', async () => {
    const locked = createInitialProject();
    locked.layouts[0].items.find(item => item.id === 'stool')!.locked = true;
    const first = sequence(gemini(moveStool), gemini(moveStool), gemini(moveStool));
    expect((await runLayoutAgent('move it', locked, { foundryToken: 'token' }, first.fetcher)).action).toBe('decline');
    const claim = { ...moveStool, goal: 'more_open_floor', moves: [{ itemId: 'stool', x: -.25, z: -1.4, rotationDegrees: 0, reason: 'Roomier.' }] };
    const second = sequence(gemini(claim), gemini(claim), gemini(claim));
    expect((await runLayoutAgent('more space', createInitialProject(), { foundryToken: 'token' }, second.fetcher)).action).toBe('decline');
  });
  it('accepts a real gain in open floor', async () => {
    const project = createInitialProject();
    const moves = [{ itemId: 'chair', x: -1.1, z: 1.35, rotationDegrees: 90, reason: 'Closer to the desk.' }];
    const { fetcher } = sequence(gemini({ ...base, action: 'rearrange', goal: 'more_open_floor', moves }));
    const result = await runLayoutAgent('more space', project, { foundryToken: 'token' }, fetcher);
    if (result.action !== 'rearrange') throw new Error(result.reply);
    expect(openFloorArea(result.layout, project.room)).toBeGreaterThan(openFloorArea(project.layouts[0], project.room));
  });
  it('fails over from Foundry to AI Pipe, and reports when nothing is configured', async () => {
    const reply = new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(moveStool) } }] }));
    const { fetcher, calls } = sequence(new Response('{}', { status: 500 }), reply);
    expect(await runLayoutAgent('tuck the stool', createInitialProject(), { foundryToken: 'a', aipipeToken: 'b' }, fetcher)).toMatchObject({ provider: 'AI Pipe', action: 'rearrange' });
    expect(calls[1].url).toContain('aipipe.org');
    expect(() => runLayoutAgent('x', createInitialProject(), {})).toThrow(LayoutAgentError);
  });
  it('only accepts saved layout ids', async () => {
    const { fetcher } = sequence(gemini({ ...base, action: 'use_layout', layoutId: 'made-up' }), gemini({ ...base, action: 'use_layout', layoutId: 'open-airy' }));
    expect(await runLayoutAgent('more room', createInitialProject(), { foundryToken: 'token' }, fetcher)).toMatchObject({ action: 'use_layout', layoutId: 'open-airy', attempts: 2 });
  });
});
