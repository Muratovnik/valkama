import { defineComponent, h } from 'vue'

/**
 * A dimension's table with its section split by a second dimension, on made-up rows by role and
 * model: each row is a pair, named by both values with the section's value first, a value of the
 * table as any other — the three measures, the period before and the change — and the pairs add
 * up to the read's total. A pair that spent in the period only in another measure is said apart as
 * such a value is: model-elm ran only as the adviser, so under agent time its pair has no figure
 * and is counted «with no agent time». A pair with a value nobody can place is no value of the
 * dimension and is named apart in the count.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { useTableModel } from '@/pages/analytics/composables/useTableModel.ts'
import type { TableModel } from '@/pages/analytics/composables/useTableModel.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'

import { usageAnswer } from '../fixtures/analytics.ts'
import { BY_ROLE_AND_MODEL } from '../fixtures/usageCases.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

/** An answer by role and model holding `rows`, its total theirs, beside a period before. */
function answerOf(rows: Usage['rows'], before: Usage['rows'] | null): Usage {
  const base = usageAnswer({ first: new Date(2026, 4, 4), days: 4, groupBy: [], stretches: [] })
  const sum = (of: Usage['rows']) => ({
    ...base.usage.total,
    agent_seconds: of.reduce((all, row) => all + row.agent_seconds, 0),
    estimated_api_cost_usd: of.reduce((all, row) => all + (row.estimated_api_cost_usd ?? 0), 0),
  })
  return {
    ...base.usage,
    group_by: ['role', 'model'],
    rows,
    total: sum(rows),
    comparison: before
      ? {
          period: { from: base.usage.period.from, to: base.usage.period.from },
          total: sum(before),
          rows: before,
          unplaced: null,
        }
      : null,
  }
}

/** What the probe renders: nothing, it only holds the table. */
const blank = () => h('span')

/** The period before: the main agent ran model-cedar for 45 minutes, and nothing else. */
const BEFORE = BY_ROLE_AND_MODEL.filter(
  (row) => row.group.role?.id === 'main' && row.group.model?.id === 'model-cedar',
).map((row) => ({ ...row, agent_seconds: 2700 }))

const SPLIT = answerOf(BY_ROLE_AND_MODEL, BEFORE)

function tableIn(measure: Measure, usage = SPLIT): TableModel {
  let model: { value: TableModel } | undefined
  mount(
    defineComponent({
      setup() {
        model = useTableModel(() => ({ by: 'role', measure, usage, across: 'model' }))
        return blank
      },
    }),
    { global: { plugins: [analyticsI18n('en')] } },
  )
  if (!model) throw new Error('no table')
  return model.value
}

const cellOf = (table: TableModel, name: string, key: string) =>
  table.lines.find((line) => line.name === name)?.cells.find((cell) => cell.key === key)

describe('a table split by a second dimension', () => {
  it('lists every pair by both names, the section value first', () => {
    const names = tableIn('time').lines.map((line) => line.name)
    // Nine rows of the read, nine pairs: none folded, none dropped.
    expect(names).toHaveLength(BY_ROLE_AND_MODEL.length)
    expect(names).toContain('Main agent · model-cedar')
    expect(names).toContain('Subagent · model-cedar')
    expect(names).toContain('Adviser · model-elm')
    expect(names).toContain('Subagent · Unknown')
    // Largest first in the measure, though the read lists it sixth: the subagent's model-cedar,
    // 41 093.274 s, is the largest pair of agent time.
    expect(names[0]).toBe('Subagent · model-cedar')
  })

  it('adds the pairs up to the read total', () => {
    const table = tableIn('time')
    const seconds = table.lines.reduce(
      (sum, line) => sum + (line.cells.find((cell) => cell.key === 'time')?.sort ?? 0),
      0,
    )
    const total = table.total.find((cell) => cell.key === 'time')?.sort ?? 0
    expect(seconds).toBeCloseTo(total, 6)
    expect(total).toBeCloseTo(SPLIT.total.agent_seconds / 3600, 6)
  })

  it('sets each pair beside the same pair in the period before', () => {
    const table = tableIn('time')
    // Three quarters of an hour before, 15 382.617 s or about 4.27 h now: the pair rose; a pair
    // that did not work before rose from nothing.
    expect(cellOf(table, 'Main agent · model-cedar', 'before')?.sort).toBeCloseTo(0.75, 6)
    expect(cellOf(table, 'Main agent · model-cedar', 'change')?.sort).toBeGreaterThan(0)
    expect(cellOf(table, 'Subagent · model-cedar', 'before')?.sort).toBe(0)
  })

  it('counts the pairs of the period in the measure, and says the rest apart', () => {
    // Five pairs of two placed values spent agent time; the adviser's two spent only tokens; the
    // two with an unknown model are no value of the dimension, so they are named.
    expect(tableIn('time').counts).toBe(
      '5 in the period · 2 with no agent time · and «Subagent · Unknown», «Main agent · Unknown»',
    )
    // Under the cost the adviser's pairs have a figure; the unknown model has no price.
    expect(tableIn('cost').counts).toMatch(/^7 in the period/u)
  })

  it('names the table by both dimensions', () => {
    expect(tableIn('time').title).toBe('Spending by role and by model')
  })
})
