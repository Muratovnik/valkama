/**
 * The period's tokens by kind, as the section of the tokens by kind ranks and sums them. The
 * oracle is the summary's rule: the tokens figure counts input, output and the cache writes, and
 * leaves the cache reads apart; reasoning is a part of output and is never added to it.
 */
import { describe, expect, it } from 'vitest'

import { countedTotal, KIND_SLOTS, kindLines } from '@/pages/analytics/utils/tokenKinds.ts'

import type { Usage } from '@/shared/api/analyticsApi.ts'
import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'

import { serveUsage, task } from './fixtures/analytics.ts'

const NONE: UsageTokens = {
  input: null,
  cached_read: null,
  cache_write_5m: null,
  cache_write_1h: null,
  output: null,
  reasoning: null,
}

/** An answer whose period holds `now` and whose period before holds `before`, one step each. */
function answer(now: Partial<UsageTokens>, before: Partial<UsageTokens> | null): Usage {
  const measures = (tokens: Partial<UsageTokens>) => ({
    agent_seconds: 60,
    estimated_seconds: 0,
    quality: 'observed' as const,
    tokens: { ...NONE, ...tokens },
    estimated_api_cost_usd: null,
    unpriced_tokens: 0,
  })
  const period = { from: '2026-11-11T00:00:00Z', to: '2026-11-12T00:00:00Z' }
  return {
    period: { ...period, step: 'day', utc_offset: 0 },
    group_by: ['work_item'],
    cost_basis: 'list prices',
    last_event_at: null,
    total: { ...measures(now), unpriced_models: [] },
    rows: [],
    series: [{ start: period.from, end: period.to, ...measures(now), groups: [] }],
    comparison: before
      ? {
          period: { from: '2026-11-10T00:00:00Z', to: period.from },
          total: { ...measures(before), unpriced_models: [] },
          rows: [],
        }
      : null,
  }
}

describe('the tokens by kind', () => {
  it('rank the counted kinds largest first, then the cache reads and the reasoning apart', () => {
    const lines = kindLines(
      answer(
        { input: 100, output: 300, cache_write_5m: 50, cached_read: 9000, reasoning: 120 },
        null,
      ),
    )
    expect(lines.map(({ kind, counted }) => [kind, counted])).toEqual([
      ['output', true],
      ['input', true],
      ['cache_write_5m', true],
      ['cached_read', false],
      ['reasoning', false],
    ])
    // The cache reads and the reasoning are never in the sum: it is the summary's figure.
    expect(countedTotal(lines)).toBe(450)
  })

  it('leave out a kind reported in neither period, and keep one reported only before', () => {
    const lines = kindLines(answer({ input: 10 }, { input: 5, cache_write_1h: 7 }))
    expect(lines.map(({ kind, count, before }) => [kind, count, before])).toEqual([
      ['input', 10, 5],
      ['cache_write_1h', null, 7],
    ])
    expect(countedTotal(lines)).toBe(10)
  })

  it('have no total when no counted kind was reported', () => {
    expect(countedTotal(kindLines(answer({ cached_read: 40 }, null)))).toBeNull()
  })

  it('add up to the tokens a breakdown counts, step by step as in total', () => {
    const query = new URLSearchParams({
      from: '2026-11-09',
      to: '2026-11-12',
      step: 'day',
      utc_offset: '0',
      group_by: 'work_item',
    })
    const { usage } = serveUsage(
      [0, 1, 2].map((day) => ({
        at: new Date(Date.UTC(2026, 10, 9 + day, 10)),
        group: { work_item: task(day + 1, `Task ${day + 1}`) },
        spend: { seconds: 600, tokens: 1_000_000 * (day + 1) + 7 },
      })),
      query,
    )
    const lines = kindLines(usage)
    expect(countedTotal(lines)).toBe(6_000_021)
    const counted = lines.filter((line) => line.counted)
    for (const [step, point] of usage.series.entries()) {
      const sum = counted.reduce((total, line) => total + (line.steps[step] ?? 0), 0)
      const anew = [
        point.tokens.input,
        point.tokens.output,
        point.tokens.cache_write_5m,
        point.tokens.cache_write_1h,
      ]
        .filter((count) => count !== null)
        .reduce((total, count) => total + count, 0)
      expect(sum).toBe(anew)
    }
  })

  it('keep one hue a kind, whatever its rank', () => {
    expect([...KIND_SLOTS]).toEqual([
      ['input', 1],
      ['cache_write_5m', 2],
      ['cache_write_1h', 3],
      ['output', 4],
    ])
  })
})
