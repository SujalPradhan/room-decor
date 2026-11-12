import { parseProject, serializeProject } from './domain';
import { layoutsDiffer } from './layout-explainer';
import { AgentReplyError, judgeProposal, prepareSituation, runAgentLoop, type AgentLoop, type Verdict } from './layout-agent-core';
import { LAYOUT_GOALS, readProposal, type AgentAnswer, type AgentPrevious, type AgentSituation, type Proposal } from './layout-agent-prompt';
import type { LayoutAgentResult } from './layout-agent-types';
import type { Project } from './types';
import ChecksWorker from './layout-agent-worker.ts?worker';

/** Accepts only a reply the app can act on. Anything else throws, and the caller falls back to rules. */
export function readLayoutAgentResult(value: unknown, project: Project): LayoutAgentResult {
  if (!value || typeof value !== 'object') throw new Error('Unreadable agent reply.');
  const result = value as LayoutAgentResult;
  if (typeof result.reply !== 'string' || !result.reply.trim() || typeof result.model !== 'string' || typeof result.provider !== 'string' || !Number.isFinite(result.elapsedMs)) throw new Error('Incomplete agent reply.');
  if (result.goals !== undefined && (!Array.isArray(result.goals) || result.goals.some(goal => !LAYOUT_GOALS.includes(goal)))) throw new Error('Invalid agent goals.');
  if (result.limits !== undefined && typeof result.limits !== 'string') throw new Error('Invalid agent limits.');
  if (result.action === 'decline') return result;
  if (result.action === 'use_layout') {
    if (!project.layouts.some(layout => layout.id === result.layoutId)) throw new Error('Unknown saved layout.');
    return result;
  }
  if (result.action !== 'rearrange') throw new Error('Unknown agent action.');
  const reasons = result.reasons;
  if (!reasons || typeof reasons !== 'object' || Object.values(reasons).some(reason => typeof reason !== 'string')) throw new Error('Invalid agent reasons.');
  if (!result.layout || project.layouts.some(layout => layout.id === result.layout.id)) throw new Error('Invalid agent layout.');
  const opened = parseProject(serializeProject({ ...project, layouts: [...project.layouts.slice(0, 11), result.layout] }));
  const layout = opened.layouts[opened.layouts.length - 1], from = project.layouts.find(item => item.id === project.activeLayoutId)!;
  if (!layoutsDiffer(from, layout)) throw new Error('The reply changes nothing.');
  return { ...result, layout };
}

/** The endpoint answered with an error other than an unreadable model reply. */
export class LayoutAgentHttpError extends Error { constructor(public status: number, public code: string | undefined) { super(`The agent endpoint answered ${status}.`); this.name = 'LayoutAgentHttpError'; } }
async function askEndpoint(fetcher: typeof fetch, request: string, situation: AgentSituation, previous: AgentPrevious | undefined, signal: AbortSignal, preferBackup: boolean): Promise<AgentAnswer> {
  const response = await fetcher('/api/layout-agent', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, situation, ...(previous ? { previous } : {}), ...(preferBackup ? { preferBackup: true } : {}) }), signal });
  const data: unknown = await response.json().catch(() => null), body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (!response.ok) {
    const code = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>).code : undefined;
    if (code === 'LAYOUT_AGENT_BAD_REPLY') throw new AgentReplyError();
    throw new LayoutAgentHttpError(response.status, typeof code === 'string' ? code : undefined);
  }
  if (typeof body.provider !== 'string' || typeof body.model !== 'string') throw new Error('Unreadable agent answer.');
  return { proposal: readProposal(body.proposal), provider: body.provider.slice(0, 80), model: body.model.slice(0, 80) };
}

type Prepared = ReturnType<typeof prepareSituation>;
type ChecksTask = { task: 'prepare'; project: Project } | { task: 'judge'; project: Project; request: string; proposal: Proposal };
export type ChecksRequest = ChecksTask & { id: number };
/** Where the layout checks run. One attempt on a large store takes over 100 ms, so the app runs them in a Web Worker. */
export interface LayoutChecks { prepare(project: Project): Promise<Prepared>; judge(project: Project, request: string, proposal: Proposal): Promise<Verdict>; close(): void }
export function inlineChecks(): LayoutChecks {
  return { prepare: async project => prepareSituation(project), judge: async (project, request, proposal) => judgeProposal(project, request, proposal), close() {} };
}
/** A module worker for the checks. Without Worker support, or if the worker fails, the same checks run inline. */
export function workerChecks(): LayoutChecks {
  const inline = inlineChecks();
  let worker: Worker | null = null, next = 0, closed = false;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void; run: () => Promise<unknown> }>();
  try { if (typeof Worker !== 'undefined') worker = new ChecksWorker(); }
  catch { worker = null; }
  const fallBack = () => {
    worker?.terminate(); worker = null;
    for (const [id, task] of pending) { pending.delete(id); task.run().then(task.resolve, task.reject); }
  };
  if (worker) {
    worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const task = pending.get(data.id);
      if (!task) return;
      pending.delete(data.id);
      if (data.error) task.reject(new Error(data.error)); else task.resolve(data.result);
    };
    worker.onerror = event => { event.preventDefault(); fallBack(); };
  }
  const call = <T,>(message: ChecksTask, run: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new DOMException('Stopped.', 'AbortError'));
    if (!worker) return run();
    const id = ++next;
    return new Promise<T>((resolve, reject) => { pending.set(id, { resolve: resolve as (value: unknown) => void, reject, run }); worker!.postMessage({ ...message, id }); });
  };
  return {
    prepare: project => call({ task: 'prepare', project }, () => inline.prepare(project)),
    judge: (project, request, proposal) => call({ task: 'judge', project, request, proposal }, () => inline.judge(project, request, proposal)),
    close() {
      closed = true; worker?.terminate(); worker = null;
      for (const task of pending.values()) task.reject(new DOMException('Stopped.', 'AbortError'));
      pending.clear();
    },
  };
}

export interface AskLayoutAgentOptions extends Pick<AgentLoop, 'signal' | 'onAttempt' | 'deadlineMs' | 'callWindowMs' | 'callShareMs'> { fetcher?: typeof fetch; checks?: LayoutChecks }
/** Runs the agent loop in the browser: the endpoint relays one model call per attempt, and every check runs here. */
export async function askLayoutAgent(request: string, project: Project, options: AskLayoutAgentOptions = {}): Promise<LayoutAgentResult> {
  const { fetcher = (input, init) => fetch(input, init), checks = workerChecks(), signal } = options, close = () => checks.close();
  signal?.addEventListener('abort', close, { once: true });
  try {
    if (signal?.aborted) throw signal.reason;
    const prepared = await checks.prepare(project);
    // Once the backup provider has answered, later attempts go to it first instead of waiting out the primary again.
    let preferBackup = false;
    const ask = async (situation: AgentSituation, previous: AgentPrevious | undefined, callSignal: AbortSignal) => {
      const answer = await askEndpoint(fetcher, request, situation, previous, callSignal, preferBackup);
      preferBackup ||= answer.provider === 'AI Pipe';
      return answer;
    };
    return await runAgentLoop(request, project, prepared, { ...options, ask, judge: proposal => checks.judge(project, request, proposal) });
  } finally {
    signal?.removeEventListener('abort', close);
    close();
  }
}
