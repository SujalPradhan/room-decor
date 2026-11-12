import { judgeProposal, prepareSituation } from './layout-agent-core';
import type { ChecksRequest } from './layout-agent-client';

/** Runs the agent's layout checks off the main thread, so the walkthrough and the page stay responsive. */
const scope = self as unknown as { onmessage: (event: MessageEvent<ChecksRequest>) => void; postMessage(message: unknown): void };
scope.onmessage = ({ data }) => {
  try {
    const result = data.task === 'prepare' ? prepareSituation(data.project) : judgeProposal(data.project, data.request, data.proposal);
    scope.postMessage({ id: data.id, result });
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'The checks failed.' });
  }
};
