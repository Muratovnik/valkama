import { defineComponent, h } from 'vue'

/**
 * A dimension's table crossed with a second one, by role and model: a column of the second
 * dimension that is zero in the measure
 * takes no place — model-elm ran only as the adviser, so under agent time it is all zeros —
 * a row of the first dimension that is zero in the measure takes no place either, and a pair that
 * spent nothing in the measure is an empty cell, «—», never «0 min». A figure the measure has no
 * price for is not zero and keeps its column.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { useTableModel } from '@/pages/analytics/composables/useTableModel.ts'
import type { TableModel } from '@/pages/analytics/composables/useTableModel.ts'
import { crossOf } from '@/pages/analytics/utils/crossFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageGroupValue, UsageRow } from '@/shared/api/analyticsApi.ts'

import { usageAnswer } from '../fixtures/analytics.ts'
import { BY_ROLE, BY_ROLE_AND_MODEL } from '../fixtures/usageCases.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

/** An answer of the period holding `rows`; the crossed table reads its rows and its total. */
const answerOf = (rows: Usage['rows']): Usage => ({
  ...usageAnswer({ first: new Date(2026, 10, 9), days: 4, groupBy: [], stretches: [] }).usage,
  rows,
})

/** What the probe renders: nothing, it only holds the table. */
const blank = () => h('span')

const BY_ROLE_READ = answerOf(BY_ROLE)
const CROSSED = answerOf(BY_ROLE_AND_MODEL)

const known = (id: string): UsageGroupValue => ({ id, unknown: false })
const TOKENS = {
  input: 2_000_000,
  cached_read: 0,
  cache_write_5m: 0,
  cache_write_1h: 0,
  output: 50_000,
  reasoning: null,
}
/** A model that worked: agent time, and the tokens that time took. */
const WORKED_ROW: UsageRow = {
  group: { model: known('model-cedar'), role: known('main') },
  agent_seconds: 3600,
  estimated_seconds: 0,
  quality: 'observed',
  tokens: TOKENS,
  estimated_api_cost_usd: 12.5,
  unpriced_tokens: 0,
}
/** A model that spent only tokens: as the adviser it has no agent time, so no figure in time. */
const TOKENS_ONLY_ROW: UsageRow = {
  group: { model: known('model-elm'), role: known('advisor') },
  agent_seconds: 0,
  estimated_seconds: 0,
  quality: null,
  tokens: { ...TOKENS, input: 1_000_000 },
  estimated_api_cost_usd: 20.5,
  unpriced_tokens: 0,
}

function tableIn(measure: Measure): TableModel {
  let model: { value: TableModel } | undefined
  mount(
    defineComponent({
      setup() {
        model = useTableModel(() => ({
          by: 'role',
          measure,
          usage: BY_ROLE_READ,
          cross: { across: 'model', usage: CROSSED },
        }))
        return blank
      },
    }),
    { global: { plugins: [analyticsI18n('en')] } },
  )
  if (!model) throw new Error('no table')
  return model.value
}

const headings = (table: TableModel) => table.columns.map((column) => column.text)
const row = (table: TableModel, name: string) =>
  table.lines.find((line) => line.name === name)?.cells.map((cell) => cell.text)

describe('a crossed table', () => {
  it('has no column that is zero in the measure', () => {
    const { columns } = crossOf(CROSSED, 'role', 'model', 'time')
    expect(columns.map((column) => column.key)).toEqual([
      'v:model-cedar',
      'v:model-birch',
      'v:model-alder',
      'v:model-damson',
      'unknown',
    ])
    expect(headings(tableIn('time'))).not.toContain('model-elm')
  })

  it('keeps the column the adviser spent in under a measure it spent in', () => {
    const { columns } = crossOf(CROSSED, 'role', 'model', 'cost')
    expect(columns.map((column) => column.key)).toContain('v:model-elm')
    // Unknown work has no price: no figure, not a zero, so it keeps its column.
    expect(columns.map((column) => column.key)).toContain('unknown')
  })

  it('says a pair that spent nothing in the measure as an empty cell', () => {
    const table = tableIn('time')
    const pairs = 5
    // The adviser spent no agent time with any model: as a column with nothing is no column, its
    // row is no row under time.
    expect(row(table, 'Adviser')).toBeUndefined()
    // The main agent ran no model-alder: empty there, its own figures elsewhere.
    const main = row(table, 'Main agent')
    expect(main?.[2]).toBe('—')
    expect(main?.[0]).not.toBe('—')
    const cells = table.lines.flatMap((line) => line.cells.slice(0, pairs).map((cell) => cell.text))
    expect(cells).toContain('—')
    expect(cells).not.toContain('0\u{A0}min')
  })

  it('counts the roles of the period in the measure, as the tile does', () => {
    // Under agent time the tile counted two roles and the table three. The
    // adviser has no row under time now, so the table agrees with the tile; its cost is a figure,
    // so under the cost all three are roles of the period.
    expect(tableIn('time').counts).toBe('2 in the period')
    expect(tableIn('cost').counts).toBe('3 in the period')
  })

  it('leaves out a row that spent nothing in the measure, as it leaves out a column', () => {
    const read = answerOf([WORKED_ROW, TOKENS_ONLY_ROW])
    const rowKeys = (measure: Measure) =>
      crossOf(read, 'model', 'role', measure).rows.map((row) => row.key)
    // The model that spent only tokens has no row under agent time, and its own row under tokens.
    expect(rowKeys('time')).toEqual(['v:model-cedar'])
    expect(rowKeys('tokens')).toContain('v:model-elm')
    // The rows left in still add up to all the agent time of the read: the dropped row held none.
    const kept = crossOf(read, 'model', 'role', 'time').rows
    expect(kept.reduce((sum, row) => sum + row.total.seconds, 0)).toBe(
      WORKED_ROW.agent_seconds + TOKENS_ONLY_ROW.agent_seconds,
    )
  })
})
