import { openFloorArea, spaceOfLayouts } from './layout-explainer';
import { bestForGoal, goalsOf, limitsOf } from './layout-goals';
import type { Layout, RoomSpec, SpaceType } from './types';

export interface LayoutIntentMatch { targetId?: string; reply: string }

const RESET = /\b(original|reset|start over|go back|back to (the )?(start|beginning))\b/;
const SPACE = /\b(clutter(ed)?|declutter|cramped|crowded|tight|messy|tidy|space|spacious|roomy|open|airy|breath(e|ing)|more room|more floor)\b/;
const THEMES: [RegExp, RegExp][] = [
  [/\b(work|workspace|work from home|wfh|study|studying|office|focus|desk|productive)\b/, /\bwork\b/],
  [/\b(rest|sleep|relax|relaxing|calm|cosy|cozy|unwind)\b/, /\brest\b/],
];
const RETAIL_THEMES: [RegExp, RegExp][] = [
  [/\b(events?|launch(es)?|workshops?|masterclass(es)?|gatherings?|community|hosting|pop-?ups?)\b/, /\bevents?\b/],
  [/\b(discovery|discover|journey|guided|guide|browse|browsing|explore|exploring|wander|wandering)\b/, /\b(discovery|journey|guided|browse|browsing|explore)\b/],
  [/\b(test|testing|try|trying|trial|sample|sampling|demo|demos)\b/, /\b(test|testing|try|trial|sampling|demo)\b/],
  [/\b(consult|consultation|consultations|advice|advisor|appointment|appointments)\b/, /\b(consult|consultation|consultations|advice|appointment)\b/],
];
/** Asking to edit the store is not asking for a layout, even when it names something a layout is known for. */
const EDIT = /\b(add(s|ing)?|remove[sd]?|removing|delete[sd]?|deleting|change[sd]?|changing|move[sd]?|moving|paint(s|ed|ing)?)\b/;
/** "Change to the event layout" switches layouts, so it is not an edit. */
const SWITCH = /\b(change|move)\s+(over\s+)?(to|into)\b|\bchange\s+(the\s+)?(layout|arrangement|setup)\b/;
const text = (layout: Layout) => `${layout.name} ${layout.description}`.toLowerCase();

/** Maps a typed request to a saved layout with fixed rules. It never invents a layout or guesses without a signal. */
export function matchLayoutIntent(prompt: string, layouts: Layout[], activeId: string, room: RoomSpec, space?: SpaceType): LayoutIntentMatch {
  const request = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
  const choose = (target: Layout, reason: string): LayoutIntentMatch => target.id === activeId ? { reply: `${target.name} is already showing. ${reason}` } : { targetId: target.id, reply: `Showing ${target.name}. ${reason}` };
  const named = layouts.filter(layout => request.includes(layout.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  if (named) return choose(named, 'You named this layout.');
  if (RESET.test(request)) {
    const original = layouts.find(layout => layout.id === 'original');
    if (original) return choose(original, 'This is the starting layout.');
  }
  const retail = (space ?? spaceOfLayouts(...layouts)) === 'retail';
  const bySpace = () => {
    if (!SPACE.test(request)) return;
    const best = layouts.map(layout => ({ layout, floor: openFloorArea(layout, room) })).sort((a, b) => b.floor - a.floor)[0];
    if (best) return choose(best.layout, `It has the largest open floor area of your saved layouts: ${best.floor.toFixed(2)} m².`);
  };
  const byTheme = () => {
    if (retail && EDIT.test(request) && !SWITCH.test(request)) return;
    for (const [asked, label] of retail ? RETAIL_THEMES : THEMES) if (asked.test(request)) {
      const themed = layouts.find(layout => label.test(text(layout)));
      if (themed) return choose(themed, 'Its description matches what you asked for.');
    }
  };
  const byGoal = () => {
    if (EDIT.test(request) && !SWITCH.test(request)) return;
    const [goal] = goalsOf(request, 'retail'), best = goal && bestForGoal(goal, layouts, room);
    if (best) return choose(best.layout, best.reason);
  };
  // "An event space" asks for the event layout in a store, so themes go first there.
  const match = retail ? byTheme() ?? byGoal() ?? bySpace() : bySpace() ?? byTheme();
  if (match) return match;
  const limits = retail ? limitsOf(request, 'retail') : [];
  if (limits.length) return { reply: `${limits.join(' ')} Try asking for more sales, easier browsing, finding products faster, more stock, a quicker checkout or wheelchair access.` };
  return { reply: `I can only switch between saved layouts: ${layouts.map(layout => layout.name).join(', ')}. ${retail ? 'Try asking for more space, more sales, for an event, or for a guided journey.' : 'Try asking for more space, or for a place to work.'}` };
}
