/**
 * The work the Agents tab's specs serve: the item's usage in each shape a test reads, the
 * goal's whole beside its own runs, the session's, and the empty week Analytics opens on.
 */
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'

import { usageAnswer as analyticsAnswer } from '../../fixtures/analytics.ts'
import {
  NO_TOKENS,
  noUsage,
  PARENT_SESSION,
  richUsage,
  sessionUsage,
  whoUsage,
} from '../../fixtures/usage.ts'
import { serve, serveGoal } from '../agentsUsagePage.ts'
import { workItem } from '../planningFixtures.ts'
import type { Served } from '../servedContracts.ts'
import { backendReads } from '../servedRoutes.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

export const noCacheWriteUsage = () =>
  richUsage({ tokens: { ...richUsage().tokens, cache_write_1h: null } })

export const unpricedUsage = () => richUsage({ unpriced_models: ['model-with-no-price'] })

/** A session nothing was read for. */
export const emptySession = () =>
  sessionUsage({
    elapsed_seconds: 0,
    agent_seconds: 0,
    tokens: NO_TOKENS,
    estimated_api_cost_usd: null,
    by_item: [],
  })

/**
 * The runs under a goal's children. Its whole read counts them, and no row of its own names
 * them: their share stands under their titles in the chain.
 */
const CHILD_RUNS: ItemUsage['agents'] = [
  {
    session_id: PARENT_SESSION,
    agent_id: 'a3a79fc900000000',
    seconds: 9520,
    tokens: NO_TOKENS,
    estimated_api_cost_usd: 20,
    unpriced_tokens: 0,
  },
  {
    session_id: PARENT_SESSION,
    agent_id: 'a58241d000000000',
    seconds: 10_000,
    tokens: NO_TOKENS,
    estimated_api_cost_usd: 21,
    unpriced_tokens: 0,
  },
]

/** The whole of a goal's work: its own runs and those under its children. */
export const goalWhole = () =>
  richUsage({
    scope: 'tree',
    agent_seconds: 60_000,
    agents: [...richUsage().agents, ...CHILD_RUNS],
  })

/** A long list with extreme numbers. */
export function extremeUsage() {
  const many = Array.from({ length: 40 }, (_, index) => ({
    session_id: PARENT_SESSION,
    agent_id: `run${String(index).padStart(13, '0')}`,
    seconds: index === 0 ? 1 : 3_600_000 - index,
    tokens: { ...NO_TOKENS, input: 9_000_000_000, output: index },
    estimated_api_cost_usd: 13_000.55,
    unpriced_tokens: 0,
  }))
  return richUsage({
    elapsed_seconds: 3_600_000,
    agent_seconds: 7_200_000,
    estimated_api_cost_usd: 13_000.55,
    agents: many,
  })
}

/** Six items, which do not fit in the page's address, so the link opens the goal's own work. */
export function sixItems(usage: ItemUsage): ItemUsage {
  const [own] = usage.by_item
  return {
    ...usage,
    by_item: [
      own,
      ...Array.from({ length: 5 }, (_, index) => ({
        ...own,
        work_item_id: `7d3e9a10-0000-4000-8000-00000000000${index + 1}`,
      })),
    ],
  } as ItemUsage
}

/** What Analytics answers the tab's link: no work in the three days it opens on. */
export const noWorkThisWeek = (query: URLSearchParams) =>
  analyticsAnswer({
    first: new Date(2026, 10, 9),
    days: 3,
    end: new Date(2026, 10, 11, 14, 30),
    groupBy: [query.get('group_by') as UsageDimension],
    stretches: [],
  })

const USAGE = [
  `/api/planning/work-item/usage?id=${workItem.work_item_id}`,
  `/api/planning/work-item/usage?id=${workItem.work_item_id}&scope=tree`,
  '/api/planning/session/usage?id=session',
]

const tab = (name: string, install: DrivenRoutes['install']): DrivenRoutes => ({
  name: `served/agentsUsage.ts ${name}`,
  install,
  reads: [...backendReads(), ...USAGE],
})

export const routes: DrivenRoutes[] = [
  tab('richUsage()', (page) => serve(page, richUsage())),
  tab('noCacheWriteUsage()', (page) => serve(page, noCacheWriteUsage())),
  tab('unpricedUsage()', (page) => serve(page, unpricedUsage())),
  tab('noUsage()', (page) => serve(page, noUsage())),
  tab('emptySession()', (page) => serve(page, richUsage(), emptySession())),
  tab('extremeUsage()', (page) => serve(page, extremeUsage())),
  tab('whoUsage()', (page) => serve(page, whoUsage())),
  tab('sixItems(whoUsage())', (page) => serve(page, sixItems(whoUsage()))),
  tab('goalWhole()', (page) => serveGoal(page, goalWhole(), () => richUsage())),
]

export const served: Served[] = ['work_item', 'account', 'model'].map((by) => ({
  name: `served/agentsUsage.ts noWorkThisWeek(${by})`,
  url: `/api/analytics/usage?group_by=${by}`,
  body: noWorkThisWeek(new URLSearchParams({ group_by: by })),
}))
