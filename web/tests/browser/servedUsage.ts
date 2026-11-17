/**
 * The usage answers a spec's work is served as: the analytics double's answer to each
 * read the page can make of it, by each dimension and pair of dimensions, compared with
 * the stretch before, over the days the work spans.
 */
import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'

import { serveUsage } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import type { Served } from './servedContracts.ts'

const DAY = 86_400_000
const dayOf = (time: number) => new Date(time).toISOString().slice(0, 10)

const GROUPINGS = [
  '',
  ...USAGE_DIMENSIONS,
  ...USAGE_DIMENSIONS.flatMap((first, at) =>
    USAGE_DIMENSIONS.slice(at + 1).map((second) => `${first},${second}`),
  ),
]

/** What the double answers for `stretches` under every grouping, named `name`. */
export function usageServed(name: string, stretches: readonly TimedStretch[]): Served[] {
  const times = stretches.map(({ at }) => at.getTime())
  const first = times.length ? Math.min(...times) : Date.UTC(2026, 10, 11)
  const last = times.length ? Math.max(...times) : first
  const span = { from: dayOf(first), to: dayOf(last + DAY), step: 'day', utc_offset: '0' }
  return GROUPINGS.map((grouping) => {
    const query = new URLSearchParams({ ...span, compare: 'true' })
    if (grouping) query.set('group_by', grouping)
    return { name, url: `/api/analytics/usage?${query}`, body: serveUsage(stretches, query) }
  })
}
