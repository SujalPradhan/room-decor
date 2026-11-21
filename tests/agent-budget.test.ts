import { describe, expect, it } from 'vitest';
import { LayoutAgentBudget, PER_DAY, PER_MINUTE, refund, spend, type BudgetState } from '../server/agent-budget';

const run = (count: number, now: number, start?: BudgetState) => {
  let state = start, allowed = 0;
  for (let index = 0; index < count; index++) { const result = spend(state, now); state = result.state; if (result.allowed) allowed++; }
  return { allowed, state };
};
describe('agent budget', () => {
  it('counts model calls, so ten three-attempt requests fit in a minute and 200 in a day', () => {
    expect([PER_MINUTE, PER_DAY]).toEqual([30, 600]);
    expect(run(3 * 10, 60_000).allowed).toBe(30);
    expect(run(3 * 10 + 1, 60_000).allowed).toBe(30);
  });
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
  it('refunds one charge, never below zero', () => {
    const charged = run(2, 60_000).state;
    expect(refund(charged, 60_000)).toMatchObject({ minuteCount: 1, dayCount: 1 });
    expect(refund(refund(refund(charged, 60_000), 60_000), 60_000)).toMatchObject({ minuteCount: 0, dayCount: 0 });
    const full = run(PER_MINUTE, 60_000).state;
    expect(spend(refund(full, 60_000), 60_000).allowed).toBe(true);
  });
  it('spends or refunds through the durable object', async () => {
    const saved = new Map<string, unknown>(), storage = { get: async <T,>(key: string) => saved.get(key) as T | undefined, put: async (key: string, value: unknown) => { saved.set(key, value); } };
    const budget = new LayoutAgentBudget({ storage });
    for (let index = 0; index < 3; index++) expect((await budget.fetch(new Request('https://budget/spend'))).status).toBe(204);
    await budget.fetch(new Request('https://budget/refund'));
    expect((saved.get('budget') as BudgetState).dayCount).toBe(2);
  });
});
