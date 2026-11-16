/**
 * A breakdown by project as the read gives it: a task's one project, the one group of tasks
 * naming several with the combinations they name, a task naming none, and unknown work. The
 * page's strict schema reads each, and no two of them share a key.
 */
import { describe, expect, it } from 'vitest'

import { valueKey, valueKind } from '@/pages/analytics/utils/usageValues.ts'

import { validateUsageAnswer } from '@/shared/api/analyticsApi.ts'

const TOKENS = {
  input: 10,
  cached_read: null,
  cache_write_5m: null,
  cache_write_1h: null,
  output: 1,
  reasoning: null,
}

const measures = (seconds: number) => ({
  agent_seconds: seconds,
  estimated_seconds: 0,
  quality: 'observed',
  tokens: TOKENS,
  estimated_api_cost_usd: 0.01,
  unpriced_tokens: 0,
})

const NOTHING = { id: null, unknown: false, name: null, combinations: null }

const PROJECTS = [
  {
    ...NOTHING,
    combinations: [
      [
        { id: 'alpha', name: 'Alpha project' },
        { id: 'beta', name: null },
      ],
    ],
  },
  { ...NOTHING, id: 'alpha', name: 'Alpha project' },
  NOTHING,
  { ...NOTHING, unknown: true },
]

const answer = {
  interface_version: 'valkama-analytics-api',
  usage: {
    period: {
      from: '2030-03-04T00:00:00+00:00',
      to: '2030-03-05T00:00:00+00:00',
      step: 'day',
      utc_offset: 0,
    },
    group_by: ['project'],
    cost_basis: 'An estimate at public API list prices.',
    last_event_at: null,
    total: { ...measures(400), unpriced_models: [] },
    rows: PROJECTS.map((project, index) => ({
      group: { project },
      ...measures(100 * (4 - index)),
    })),
    series: [],
    comparison: null,
  },
}

describe('a breakdown by project', () => {
  it('is read with the combinations of the group of several', () => {
    const usage = validateUsageAnswer(answer)
    expect(usage.rows[0]?.group.project?.combinations).toEqual(PROJECTS[0]?.combinations)
  })

  it('keeps several projects, no project and unknown work apart', () => {
    const values = validateUsageAnswer(answer).rows.flatMap((row) => row.group.project ?? [])
    expect(values.map((value) => valueKind(value))).toEqual(['none', 'category', 'none', 'unknown'])
    expect(values.map((value) => valueKey(value))).toEqual([
      'several',
      'v:alpha',
      'none',
      'unknown',
    ])
  })

  it('refuses a combination of one project', () => {
    const project = { ...NOTHING, combinations: [[{ id: 'alpha', name: null }]] }
    const one = {
      ...answer,
      usage: { ...answer.usage, rows: [{ group: { project }, ...measures(400) }] },
    }
    expect(() => validateUsageAnswer(one)).toThrow()
  })
})
