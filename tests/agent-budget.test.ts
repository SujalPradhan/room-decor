import { describe, expect, it } from 'vitest';
import { PER_DAY, PER_MINUTE, spend, type BudgetState } from '../server/agent-budget';

const run = (count: number, now: number, start?: BudgetState) => {
  let state = start, allowed = 0;
  for (let index = 0; index < count; index++) { const result = spend(state, now); state = result.state; if (result.allowed) allowed++; }
  return { allowed, state };
};
describe('agent budget', () => {
  it('allows exactly the per-minute limit, then resets next minute', () => {
    const first = run(PER_MINUTE + 5, 60_000);
    expect(first.allowed).toBe(PER_MINUTE);
    expect(run(1, 120_000, first.state).allowed).toBe(1);
  });
  it('stops at the daily cap until the next day', () => {
    const state = { minute: 0, minuteCount: 0, day: 1, dayCount: PER_DAY };
    expect(run(1, 86_400_000 + 60_000, state).allowed).toBe(0);
    expect(run(1, 2 * 86_400_000, state).allowed).toBe(1);
  });
});
