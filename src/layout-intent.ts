import { openFloorArea } from './layout-explainer';
import type { Layout, RoomSpec } from './types';

export interface LayoutIntentMatch { targetId?: string; reply: string }

const RESET = /\b(original|reset|start over|go back|back to (the )?(start|beginning))\b/;
const SPACE = /\b(clutter(ed)?|declutter|cramped|crowded|tight|messy|tidy|space|spacious|roomy|open|airy|breath(e|ing)|more room|more floor)\b/;
const THEMES: [RegExp, RegExp][] = [
  [/\b(work|workspace|work from home|wfh|study|studying|office|focus|desk|productive)\b/, /\bwork\b/],
  [/\b(rest|sleep|relax|relaxing|calm|cosy|cozy|unwind)\b/, /\brest\b/],
];
const text = (layout: Layout) => `${layout.name} ${layout.description}`.toLowerCase();

/** Maps a typed request to a saved layout with fixed rules. It never invents a layout or guesses without a signal. */
export function matchLayoutIntent(prompt: string, layouts: Layout[], activeId: string, room: RoomSpec): LayoutIntentMatch {
  const request = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  const choose = (target: Layout, reason: string): LayoutIntentMatch => target.id === activeId ? { reply: `${target.name} is already showing. ${reason}` } : { targetId: target.id, reply: `Showing ${target.name}. ${reason}` };
  const named = layouts.filter(layout => request.includes(layout.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  if (named) return choose(named, 'You named this layout.');
  if (RESET.test(request)) {
    const original = layouts.find(layout => layout.id === 'original');
    if (original) return choose(original, 'This is the starting layout.');
  }
  if (SPACE.test(request)) {
    const best = layouts.map(layout => ({ layout, floor: openFloorArea(layout, room) })).sort((a, b) => b.floor - a.floor)[0];
    if (best) return choose(best.layout, `It has the largest open floor area of your saved layouts: ${best.floor.toFixed(2)} m².`);
  }
  for (const [asked, label] of THEMES) if (asked.test(request)) {
    const themed = layouts.find(layout => label.test(text(layout)));
    if (themed) return choose(themed, 'Its description matches what you asked for.');
  }
  return { reply: `I can only switch between saved layouts: ${layouts.map(layout => layout.name).join(', ')}. Try asking for more space, or for a place to work.` };
}
