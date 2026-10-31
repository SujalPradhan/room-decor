import { parseProject, serializeProject } from './domain';
import { buildLayoutExplanation } from './layout-explainer';
import type { LayoutAgentResult } from './layout-agent-types';
import type { Project } from './types';

/** Accepts only a reply the app can act on. Anything else throws, and the caller falls back to rules. */
export function readLayoutAgentResult(value: unknown, project: Project): LayoutAgentResult {
  if (!value || typeof value !== 'object') throw new Error('Unreadable agent reply.');
  const result = value as LayoutAgentResult;
  if (typeof result.reply !== 'string' || !result.reply.trim() || typeof result.model !== 'string' || typeof result.provider !== 'string' || !Number.isFinite(result.elapsedMs)) throw new Error('Incomplete agent reply.');
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
  if (!buildLayoutExplanation(from, layout, project.room).steps.length) throw new Error('The reply changes nothing.');
  return { ...result, layout };
}
