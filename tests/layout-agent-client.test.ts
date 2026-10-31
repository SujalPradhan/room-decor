import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/domain';
import { readLayoutAgentResult } from '../src/layout-agent-client';

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
