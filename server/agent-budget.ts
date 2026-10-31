export const PER_MINUTE = 10, PER_DAY = 200;
export interface BudgetState { minute: number; minuteCount: number; day: number; dayCount: number }
const EMPTY: BudgetState = { minute: 0, minuteCount: 0, day: 0, dayCount: 0 };

export function spend(saved: BudgetState | undefined, now: number): { allowed: boolean; state: BudgetState } {
  const minute = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000), state = { ...(saved ?? EMPTY) };
  if (state.minute !== minute) Object.assign(state, { minute, minuteCount: 0 });
  if (state.day !== day) Object.assign(state, { day, dayCount: 0 });
  if (state.minuteCount >= PER_MINUTE || state.dayCount >= PER_DAY) return { allowed: false, state };
  state.minuteCount++; state.dayCount++;
  return { allowed: true, state };
}

/** One object counts for the whole site. Calls run one at a time, so the limits are exact, unlike the rate-limit binding. */
export class LayoutAgentBudget {
  constructor(private readonly durable: { storage: { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> } }) {}
  async fetch(): Promise<Response> {
    const { allowed, state } = spend(await this.durable.storage.get<BudgetState>('budget'), Date.now());
    await this.durable.storage.put('budget', state);
    return new Response(null, { status: allowed ? 204 : 429 });
  }
}
