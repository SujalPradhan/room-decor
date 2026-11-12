import type { LayoutGoal } from './layout-agent-prompt';
import type { Layout } from './types';

interface AgentRun { reply: string; provider: string; model: string; attempts: number; elapsedMs: number; goals?: LayoutGoal[]; limits?: string; rejected?: string[][] }
export type LayoutAgentResult =
  | (AgentRun & { action: 'rearrange'; layout: Layout; reasons: Record<string, string>; shorts?: Record<string, string> })
  | (AgentRun & { action: 'use_layout'; layoutId: string })
  | (AgentRun & { action: 'decline' });
