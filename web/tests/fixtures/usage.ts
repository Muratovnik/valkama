/**
 * What the usage reads answer. Every number here is made up; the rich item keeps the shape
 * real items have, where cached reads dwarf everything else.
 */
import type {
  ItemUsage,
  SessionUsage,
  UsageLine,
  UsageTokens,
} from '@/shared/api/planningUsageApi.ts'

const WORK_ITEM_ID = '00000000-0000-4000-8000-000000000012'
export const PARENT_SESSION = '6f1c2a8e-0000-4000-8000-000000000001'

const COST_BASIS =
  'An estimate at public API list prices for each request. A subscription pays differently, so this is not a bill.'

export const NO_TOKENS: UsageTokens = {
  input: null,
  cached_read: null,
  cache_write_5m: null,
  cache_write_1h: null,
  output: null,
  reasoning: null,
}

export const SPENT: UsageTokens = {
  input: 5_000_000,
  cached_read: 392_000_000,
  cache_write_5m: 11_000_000,
  cache_write_1h: 400_000,
  output: 1_900_000,
  reasoning: 600_000,
}

function usageLine(overrides: Partial<UsageLine> = {}): UsageLine {
  return {
    work_item_id: WORK_ITEM_ID,
    reference: 'MAIN-12',
    title: 'An item',
    elapsed_seconds: 0,
    agent_seconds: 0,
    tokens: NO_TOKENS,
    estimated_api_cost_usd: null,
    unpriced_tokens: 0,
    ...overrides,
  }
}

/** What the read says of an item nobody's work reached. */
export function noUsage(overrides: Partial<ItemUsage> = {}): ItemUsage {
  return {
    work_item_id: WORK_ITEM_ID,
    reference: 'MAIN-12',
    title: 'An item',
    scope: 'item',
    elapsed_seconds: 0,
    agent_seconds: 0,
    tokens: NO_TOKENS,
    estimated_api_cost_usd: null,
    unpriced_tokens: 0,
    cost_basis: COST_BASIS,
    unpriced_models: [],
    agents: [],
    models: [],
    signals: [],
    quality: null,
    estimated_seconds: 0,
    account_stretches: [],
    accounts: [],
    roles: [],
    by_item: [usageLine()],
    ...overrides,
  }
}

/** One agent and the session's own run, one model of them called on the side. */
export function richUsage(overrides: Partial<ItemUsage> = {}): ItemUsage {
  return noUsage({
    elapsed_seconds: 27_520,
    agent_seconds: 40_480,
    tokens: SPENT,
    estimated_api_cost_usd: 240.67,
    agents: [
      {
        session_id: PARENT_SESSION,
        agent_id: 'agent00000000000',
        seconds: 30_000,
        tokens: { ...SPENT, cached_read: 300_000_000 },
        estimated_api_cost_usd: 180,
        unpriced_tokens: 0,
      },
      {
        session_id: PARENT_SESSION,
        agent_id: null,
        seconds: 10_480,
        tokens: { ...NO_TOKENS, input: 1000, output: 500 },
        estimated_api_cost_usd: 60.67,
        unpriced_tokens: 0,
      },
    ],
    models: [
      {
        model: 'claude-example-1',
        seconds: 40_480,
        tokens: SPENT,
        estimated_api_cost_usd: 174.35,
        unpriced_tokens: 0,
      },
      {
        model: 'claude-example-2',
        seconds: 0,
        tokens: { ...NO_TOKENS, input: 1000, output: 500 },
        estimated_api_cost_usd: 66.32,
        unpriced_tokens: 0,
      },
    ],
    signals: [{ signal: 'next_write', seconds: 40_480, share: 1 }],
    quality: 'estimated',
    estimated_seconds: 40_480,
    by_item: [usageLine({ elapsed_seconds: 27_520, agent_seconds: 40_480, tokens: SPENT })],
    ...overrides,
  })
}

/** A session that worked on the item and on what names no item. */
export function sessionUsage(overrides: Partial<SessionUsage> = {}): SessionUsage {
  const usage = richUsage()
  return {
    elapsed_seconds: 344_733,
    agent_seconds: 864_114,
    tokens: SPENT,
    estimated_api_cost_usd: 4888.76,
    unpriced_tokens: 0,
    cost_basis: usage.cost_basis,
    unpriced_models: [],
    agents: usage.agents,
    models: usage.models,
    signals: usage.signals,
    quality: 'mixed',
    estimated_seconds: 100,
    session_id: PARENT_SESSION,
    first_at: '2026-08-13T08:00:00Z',
    last_at: '2026-08-13T18:00:00Z',
    excluded: { human: 10, subagent: 20, external: 30, gap: 40 },
    runs: [
      {
        agent_id: null,
        client: 'claude',
        status: 'reading',
        first_at: '2026-08-13T08:00:00Z',
        last_at: '2026-08-13T18:00:00Z',
        read_at: '2026-08-13T18:00:00Z',
        excluded: { human: 10, subagent: 20, external: 30, gap: 40 },
      },
    ],
    by_item: [
      usageLine({ elapsed_seconds: 27_520, agent_seconds: 40_480, tokens: SPENT }),
      usageLine({
        work_item_id: null,
        reference: null,
        title: null,
        elapsed_seconds: 151_007,
        agent_seconds: 288_983,
        tokens: SPENT,
        estimated_api_cost_usd: 1634.49,
      }),
    ],
    ...overrides,
  }
}

/** What the read says of a session it has not read yet: empty rather than unknown. */
export function noSessionUsage(): SessionUsage {
  return sessionUsage({
    elapsed_seconds: 0,
    agent_seconds: 0,
    tokens: NO_TOKENS,
    estimated_api_cost_usd: null,
    agents: [],
    models: [],
    signals: [],
    quality: null,
    estimated_seconds: 0,
    first_at: null,
    last_at: null,
    runs: [],
    by_item: [],
  })
}

export const usageAnswer = (usage: ItemUsage | SessionUsage) => ({
  interface_version: 'valkama-planning-api',
  usage,
})
