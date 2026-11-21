import { expect, test } from 'vitest';
import { prepareSituation } from '../src/layout-agent-core';
import { askLayoutModel, layoutProviders, readLayoutAgentInput } from '../server/layout-agent';
import { crowdedMoves, flagshipStore } from './fixtures/flagship-store';

/**
 * Server work for the largest body the endpoint accepts: 70 pieces, 12 layouts and a full retry with 12 problems.
 * Covers body parsing, validation, the prompt rebuild, the provider request body and parsing the reply.
 * A Workers free plan gives a request about 10 ms of CPU; this keeps the gateway well under 3 ms.
 */
const project = flagshipStore(), { situation } = prepareSituation(project);
const proposal = { action: 'rearrange', goal: 'other', layoutId: '', name: 'Busy', description: 'A crowded try', reply: 'Moved seven pieces.', moves: crowdedMoves(project), removals: [], recolors: [], additions: [], wallColor: '', accentColor: '', colorReason: '' };
const body = JSON.stringify({ request: 'Make room for an event and guide customers past the testing bars', situation, previous: { proposal, problems: Array.from({ length: 12 }, (_, index) => `Leave room to use ${situation.furniture[index].name.toLowerCase()}; ${situation.furniture[index + 1].name.toLowerCase()} is in its access space.`) } });
const reply = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(proposal) }] } }] });
const providers = layoutProviders({ foundryToken: 'token' }, (async (_url: string, init: RequestInit) => { void String(init.body).length; return new Response(reply); }) as unknown as typeof fetch);

test('one gateway call on the largest allowed body stays under 3 ms', async ({ bench }) => {
  expect(situation.furniture).toHaveLength(70);
  expect(situation.savedLayouts).toHaveLength(12);
  const result = await bench('layout-agent gateway, 70 pieces and 12 layouts', async () => { await askLayoutModel(readLayoutAgentInput(JSON.parse(body)), providers); }).run({ time: 1000 });
  console.log(`gateway: body ${body.length} B, mean ${result.latency.mean.toFixed(3)} ms, p99 ${result.latency.p99.toFixed(3)} ms, ${result.latency.samplesCount} samples`);
  expect(result.latency.mean).toBeLessThan(3);
});
