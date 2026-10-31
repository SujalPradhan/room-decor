import { describe, expect, it } from 'vitest';
import { createInitialProject, parseProject, serializeProject, validateLayout } from '../src/domain';
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
const invalid = { ...base, action: 'rearrange', moves: [{ itemId: 'sofa', x: 0, z: 0, rotationDegrees: 0, reason: 'Nope.' }] };
const onBed = { ...base, action: 'rearrange', moves: [{ itemId: 'stool', x: -.5, z: .05, rotationDegrees: 0, reason: 'Close by.' }] };

describe('room agent loop', () => {
  it('returns a checked arrangement with the reason for each move', async () => {
    const { fetcher } = sequence(gemini(moveStool));
    const result = await runLayoutAgent('tuck the stool away', createInitialProject(), { foundryToken: 'token' }, fetcher);
    expect(result).toMatchObject({ action: 'rearrange', attempts: 1, reasons: { stool: 'Out of the way.' }, provider: 'LLM Foundry' });
  });
  it('feeds rejected moves back and accepts the corrected proposal', async () => {
    const { fetcher, calls } = sequence(gemini(invalid), gemini(moveStool));
    const result = await runLayoutAgent('move the stool', createInitialProject(), { foundryToken: 'token' }, fetcher);
    expect(result).toMatchObject({ action: 'rearrange', attempts: 2 });
    expect(calls[1].body).toContain('rejected by the room checks');
  });
  it('declines after three failed attempts instead of returning an invalid room', async () => {
    const { fetcher, calls } = sequence(gemini(invalid), gemini(invalid), gemini(invalid));
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
    expect(await runLayoutAgent('more space', createInitialProject(), { foundryToken: 'token' }, second.fetcher)).toMatchObject({ action: 'use_layout', layoutId: 'open-airy' });
  });
  it('slides a colliding piece to the nearest valid spot', async () => {
    const project = createInitialProject();
    const { fetcher } = sequence(gemini(onBed));
    const result = await runLayoutAgent('put the stool by the bed', project, { foundryToken: 'token' }, fetcher);
    if (result.action !== 'rearrange') throw new Error(result.reply);
    expect(validateLayout(result.layout, project.room).length).toBeLessThanOrEqual(validateLayout(project.layouts[0], project.room).length);
    expect(result.layout.items.find(item => item.id === 'stool')!.position).not.toEqual({ x: -.5, z: .05 });
  });
  it('judges only what changed, so an existing chair position cannot block a repaint', async () => {
    const project = createInitialProject();
    project.layouts[0].items.find(item => item.id === 'chair')!.position = { x: 1.2, z: 1.5 };
    const { fetcher } = sequence(gemini({ ...base, action: 'rearrange', wallColor: '#112233', accentColor: '#112233', colorReason: 'Darker.' }));
    expect(await runLayoutAgent('paint the walls', project, { foundryToken: 'token' }, fetcher)).toMatchObject({ action: 'rearrange' });
  });
  it('rejects a no-op, states removals the model left out, and does not expose ids', async () => {
    const noop = { ...base, action: 'rearrange', moves: [{ itemId: 'stool', x: -.25, z: -1.45, rotationDegrees: 0, reason: 'Same.' }] };
    const first = sequence(gemini(noop), gemini(noop), gemini(noop));
    expect((await runLayoutAgent('x', createInitialProject(), { foundryToken: 'token' }, first.fetcher)).reply).toContain('changes nothing');
    const second = sequence(gemini({ ...base, action: 'rearrange', removals: [{ itemId: 'stool', reason: 'Gone.' }] }));
    expect((await runLayoutAgent('tidy', createInitialProject(), { foundryToken: 'token' }, second.fetcher)).reply).toContain('Removed: Small stool.');
  });
  it('does not repeat a removal the reply already names, and respects the item cap', async () => {
    const first = sequence(gemini({ ...base, action: 'rearrange', reply: 'The stool is gone.', removals: [{ itemId: 'stool', reason: 'Gone.' }] }));
    expect((await runLayoutAgent('lose the stool', createInitialProject(), { foundryToken: 'token' }, first.fetcher)).reply).toBe('The stool is gone.');
    const full = createInitialProject(), filler = full.layouts[0].items.find(item => item.id === 'stool')!;
    for (let index = full.layouts[0].items.length; index < 80; index++) full.layouts[0].items.push({ ...filler, id: `filler-${index}`, visible: false });
    const plan = { ...base, action: 'rearrange', additions: [{ kind: 'plant', x: 1.7, z: 1, rotationDegrees: 0, reason: 'Green.' }] };
    const second = sequence(gemini(plan), gemini(plan), gemini(plan));
    expect((await runLayoutAgent('add a plant', full, { foundryToken: 'token' }, second.fetcher)).reply).toContain('at most 80');
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
  it('repaints, removes, recolours and adds through the same checks', async () => {
    const plan = { ...base, action: 'rearrange', wallColor: '#6b4c9a', accentColor: '#6b4c9a', colorReason: 'Purple walls.', removals: [{ itemId: 'stool', reason: 'Not needed.' }], recolors: [{ itemId: 'wardrobe', color: '#ffffff', reason: 'Brighter.' }], additions: [{ kind: 'plant', x: 1.7, z: 1, rotationDegrees: 0, reason: 'Some green.' }] };
    const { fetcher } = sequence(gemini(plan));
    const project = createInitialProject();
    const result = await runLayoutAgent('purple walls, lose the stool', project, { foundryToken: 'token' }, fetcher);
    if (result.action !== 'rearrange') throw new Error(result.reply);
    expect(result.layout).toMatchObject({ wallColor: '#6b4c9a', accentColor: '#6b4c9a' });
    expect(result.layout.items.some(item => item.id === 'stool')).toBe(false);
    expect(result.layout.items.find(item => item.id === 'wardrobe')?.color).toBe('#ffffff');
    expect(result.layout.items.some(item => item.kind === 'plant')).toBe(true);
    expect(result.reasons).toMatchObject({ finish: 'Purple walls.', stool: 'Not needed.' });
    expect(() => parseProject(serializeProject({ ...project, layouts: [...project.layouts, result.layout] }))).not.toThrow();
  });
  it('rejects bad colours, locked removals and items outside the catalogue', async () => {
    const locked = createInitialProject();
    locked.layouts[0].items.find(item => item.id === 'stool')!.locked = true;
    for (const [plan, project] of [
      [{ ...base, action: 'rearrange', wallColor: 'purple', colorReason: 'x' }, createInitialProject()],
      [{ ...base, action: 'rearrange', removals: [{ itemId: 'stool', reason: 'x' }] }, locked],
      [{ ...base, action: 'rearrange', additions: [{ kind: 'sofa', x: 0, z: 0, rotationDegrees: 0, reason: 'x' }] }, createInitialProject()],
    ] as const) {
      const { fetcher } = sequence(gemini(plan), gemini(plan), gemini(plan));
      expect((await runLayoutAgent('change it', project as ReturnType<typeof createInitialProject>, { foundryToken: 'token' }, fetcher)).action).toBe('decline');
    }
  });
});
