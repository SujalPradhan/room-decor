/** Counted per model call. One request in the app takes up to three calls, so this is ten requests a minute and 200 a day at worst. */
export const PER_MINUTE = 30, PER_DAY = 600;
export interface BudgetState { minute: number; minuteCount: number; day: number; dayCount: number }
const EMPTY: BudgetState = { minute: 0, minuteCount: 0, day: 0, dayCount: 0 };

function current(saved: BudgetState | undefined, now: number): BudgetState {
  const minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000), state = { ...(saved ?? EMPTY) };
  if (state.minute !== minute) Object.assign(state, { minute, minuteCount: 0 });
  if (state.day !== day) Object.assign(state, { day, dayCount: 0 });
  return state;
}
export function spend(saved: BudgetState | undefined, now: number): { allowed: boolean; state: BudgetState } {
  const state = current(saved, now);
  if (state.minuteCount >= PER_MINUTE || state.dayCount >= PER_DAY) return { allowed: false, state };
  state.minuteCount++; state.dayCount++;
  return { allowed: true, state };
}
/**
 * Gives back the charge for a call no provider answered. The endpoint refunds only after charging,
 * so refunds can never lift the allowance above the limits; a charge that straddles a minute is refunded from the new one.
 */
export function refund(saved: BudgetState | undefined, now: number): BudgetState {
  const state = current(saved, now);
  state.minuteCount = Math.max(0, state.minuteCount - 1); state.dayCount = Math.max(0, state.dayCount - 1);
  return state;
}

/** One object counts for the whole site. Calls run one at a time, so the limits are exact, unlike the rate-limit binding. */
export class LayoutAgentBudget {
  constructor(private readonly durable: { storage: { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> } }) {}
  async fetch(request?: Request): Promise<Response> {
    const saved = await this.durable.storage.get<BudgetState>('budget');
    if (request && new URL(request.url).pathname === '/refund') {
      await this.durable.storage.put('budget', refund(saved, Date.now()));
      return new Response(null, { status: 204 });
    }
    const { allowed, state } = spend(saved, Date.now());
    await this.durable.storage.put('budget', state);
    return new Response(null, { status: allowed ? 204 : 429 });
  }
}
