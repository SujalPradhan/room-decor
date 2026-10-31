import type { Layout } from './types';

interface AgentRun { reply: string; provider: string; model: string; attempts: number; elapsedMs: number }
export type LayoutAgentResult =
  | (AgentRun & { action: 'rearrange'; layout: Layout; reasons: Record<string, string> })
  | (AgentRun & { action: 'use_layout'; layoutId: string })
  | (AgentRun & { action: 'decline' });
