import { goalsOf, limitsOf, type LayoutGoal } from './layout-goals';
import type { LayoutAgentResult } from './layout-agent-types';
import type { Project, SpaceType } from './types';

export interface AgentRunRecord {
  at: number;
  request: string;
  space: SpaceType;
  source: 'agent' | 'rules';
  outcome: 'rearrange' | 'use_layout' | 'decline' | 'rules_switch' | 'rules_none';
  reply: string;
  note?: string;
  provider?: string;
  model?: string;
  attempts?: number;
  elapsedMs?: number;
  rejected: string[][];
  goals: LayoutGoal[];
  limits: string[];
  changes?: number;
  layoutName?: string;
  size: { width: number; depth: number };
  pieces: number;
  layouts: number;
}
const KEY = 'roomshift-agent-run-v1';

function scene(request: string, project: Project) {
  const active = project.layouts.find(layout => layout.id === project.activeLayoutId) ?? project.layouts[0];
  return { at: Date.now(), request, space: project.space ?? 'room', size: { width: project.room.width, depth: project.room.depth }, pieces: active.items.length, layouts: project.layouts.length };
}
export function agentRecord(request: string, project: Project, result: LayoutAgentResult): AgentRunRecord {
  const space = project.space ?? 'room', goals = [...new Set([...(result.goals ?? []), ...goalsOf(request, space)])];
  const limits = result.limits?.trim() ? [result.limits.trim()] : limitsOf(request, space, goals);
  const layoutName = result.action === 'rearrange' ? result.layout.name : result.action === 'use_layout' ? project.layouts.find(layout => layout.id === result.layoutId)?.name : undefined;
  return {
    ...scene(request, project), source: 'agent', outcome: result.action, reply: result.reply, provider: result.provider, model: result.model, attempts: result.attempts, elapsedMs: result.elapsedMs,
    rejected: result.rejected ?? [], goals, limits, layoutName,
    ...(result.action === 'rearrange' && { changes: Object.keys(result.reasons).filter(key => key !== 'finish').length }),
  };
}
export function rulesRecord(request: string, project: Project, reply: string, note: string, targetId?: string): AgentRunRecord {
  const space = project.space ?? 'room', goals = goalsOf(request, space);
  return { ...scene(request, project), source: 'rules', outcome: targetId ? 'rules_switch' : 'rules_none', reply, note, rejected: [], goals, limits: limitsOf(request, space, goals), layoutName: project.layouts.find(layout => layout.id === targetId)?.name };
}
export function saveRun(record: AgentRunRecord) {
  try { localStorage.setItem(KEY, JSON.stringify(record)); } catch { return; }
}
export function readRun(): AgentRunRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return value && typeof value === 'object' && typeof value.request === 'string' && Array.isArray(value.rejected) && Array.isArray(value.goals) && Array.isArray(value.limits) ? value : null;
  } catch { return null; }
}
