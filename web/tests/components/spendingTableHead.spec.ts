/**
 * The few words over a dimension's table about its rows: how many values of the period it lists
 * in the measure, which is the count the rail's tile gives; how many spent in the period nothing
 * there, said in the measure's own words; and how many spent only before it. A row of no value is
 * none of the values, and a part with nothing in it is not said.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingTableHead from '@/pages/analytics/components/SpendingTableHead.vue'
import type { TableLine } from '@/pages/analytics/composables/useTableModel.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'

import { analyticsI18n } from '../support/analyticsReads.ts'

const line = (name: string, when: TableLine['when'], rest = false): TableLine => ({
  cells: [],
  key: name,
  name,
  rest,
  value: { id: name, unknown: false },
  valueName: name,
  when,
})

/** Under agent time: two roles worked, the adviser spent only tokens, one role only before. */
const ROLES = [
  line('main', 'now'),
  line('subagent', 'now'),
  line('advisor', 'elsewhere'),
  line('reviewer', 'before'),
  line('No value', 'elsewhere', true),
]

function countsOf(lines: TableLine[], measure: Measure, locale: 'en' | 'ru' = 'en', split = false) {
  const head = mount(SpendingTableHead, {
    props: {
      by: 'role',
      cross: split ? { status: 'reading', usage: null } : { status: 'off' },
      lines,
      measure,
      summary: '',
      title: 'Spending by role',
      waiting: false,
    },
    global: { plugins: [analyticsI18n(locale)] },
  })
  return head.get('.spending-table-summary').text().replaceAll(/\s+/gu, ' ').trim()
}

describe('the words over a dimension’s table', () => {
  it('count the values in the measure and say those with nothing there apart', () => {
    expect(countsOf(ROLES, 'time')).toBe('2 roles · 1 with no agent time · 1 outside the period')
    expect(countsOf(ROLES, 'time', 'ru')).toBe('2 роли · 1 без времени агентов · 1 вне периода')
    expect(countsOf(ROLES, 'cost', 'ru')).toBe('2 роли · 1 без цены · 1 вне периода')
    expect(countsOf(ROLES, 'tokens')).toBe('2 roles · 1 with no tokens · 1 outside the period')
  })

  it('count pairs, not values of the section, while it is split', () => {
    expect(countsOf(ROLES, 'time', 'en', true)).toBe(
      '2 pairs · 1 with no agent time · 1 outside the period',
    )
    expect(countsOf(ROLES.slice(0, 1), 'time', 'ru', true)).toBe('1 пара')
  })

  it('say no part that holds nothing', () => {
    expect(countsOf([line('main', 'now'), line('No value', 'elsewhere', true)], 'time')).toBe(
      '1 role',
    )
  })
})
