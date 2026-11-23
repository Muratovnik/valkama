/**
 * The form a section's breakdown takes by how its values are named. The oracle is the owner's
 * rule: the tasks and the sessions are named by their titles, free text, and drawn as a list only,
 * with no ring and no switch but the table's, where either side of a pair is one of them; a
 * breakdown named by identifiers keeps its ring and opens on it.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import DonutChart from '@/shared/ui/DonutChart.vue'
import RankedBars from '@/shared/ui/RankedBars.vue'

import { task, usageAnswer, value } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'
import { viewsOf } from '../support/chartViews.ts'

/** A value of each dimension the cases read, the sessions by a title as the page names them. */
const group = (index: number) => ({
  work_item: task(index, `Task ${index}`),
  executor: { ...value(`session-${index}`), title: `Session ${index}` },
  model: value(`model-${index}`),
  effort: value(`effort-${index}`),
})

function mountSection(by: UsageDimension, across: UsageDimension | null, locale: 'en' | 'ru') {
  const rows = usageAnswer({
    first: new Date(2026, 10, 9),
    days: 7,
    groupBy: across ? [by, across] : [by],
    stretches: [1, 2].map((index) => ({
      day: 0,
      group: group(index),
      spend: { seconds: index * 600 },
    })),
  }).usage.rows
  return mount(SpendingBars, {
    props: { rows, by, across, measure: 'time', slots: new Map() },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

describe('the form of a breakdown', () => {
  it.each([
    { by: 'work_item', across: null },
    { by: 'executor', across: null },
    { by: 'work_item', across: 'model' },
    { by: 'model', across: 'work_item' },
    { by: 'model', across: 'executor' },
  ] as const)(
    'draws one by $by split by $across as a list only, with no ring',
    ({ by, across }) => {
      const section = mountSection(by, across, 'ru')
      expect(viewsOf(section, '.spending-bars')).toEqual({
        offered: ['График', 'Таблица'],
        shown: 'График',
      })
      expect(section.findComponent(DonutChart).exists()).toBe(false)
      expect(section.getComponent(RankedBars).props('freeText')).toBe(true)
    },
  )

  it('keeps the ring and its switch for a breakdown named by identifiers', () => {
    const byModel = mountSection('model', null, 'ru')
    expect(viewsOf(byModel, '.spending-bars')).toEqual({
      offered: ['Кольцо', 'Полосы', 'Таблица'],
      shown: 'Кольцо',
    })
    expect(byModel.findComponent(DonutChart).exists()).toBe(true)
    // Split by another identifier, its pairs are bars alone, with no list of free text.
    const split = mountSection('model', 'effort', 'en')
    expect(viewsOf(split, '.spending-bars')).toEqual({ offered: ['Bars', 'Table'], shown: 'Bars' })
    expect(split.getComponent(RankedBars).props('freeText')).toBe(false)
  })
})
