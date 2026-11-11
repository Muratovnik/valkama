/**
 * The filters' «none» as the read admits it. The oracle is the contract of `none`: it admits work
 * on no item for a task, a session's own run for a launch class, an unknown value for the rest,
 * and nothing for a role, since every stretch has one. So the choice is named by what it admits,
 * and a role offers no such choice at all.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AnalyticsFilters from '@/pages/analytics/components/AnalyticsFilters.vue'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'

import { task, usageAnswer, value } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

const DIMENSIONS: UsageDimension[] = ['work_item', 'launch_class', 'role', 'model']

/** The values each filter was read with: one of each dimension's own, so «none» stands first. */
const read = (dimension: UsageDimension) =>
  usageAnswer({
    first: new Date(2026, 10, 9),
    days: 1,
    groupBy: [dimension],
    stretches: [
      {
        day: 0,
        group: {
          work_item: task(1, 'One'),
          launch_class: value('general'),
          role: value('main'),
          model: value('model-a'),
        },
        spend: { seconds: 60 },
      },
    ],
  }).usage.rows

function offered(locale: 'en' | 'ru') {
  const filters = mount(AnalyticsFilters, {
    props: {
      dimensions: DIMENSIONS,
      filters: {},
      values: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, read(dimension)])),
    },
    global: { plugins: [analyticsI18n(locale)] },
  })
  return Object.fromEntries(
    filters
      .findAllComponents(SearchCombobox)
      .map((field) => [
        field.attributes('data-dimension'),
        (field.props() as { options: ChoiceOption[] }).options.map((option) => option.label),
      ]),
  )
}

describe('the filters', () => {
  it.each([
    {
      locale: 'en',
      expected: {
        work_item: ['No task', 'MAIN-1 One'],
        launch_class: ['The session itself', 'general'],
        role: ['Main agent'],
        model: ['Unknown', 'model-a'],
      },
    },
    {
      locale: 'ru',
      expected: {
        work_item: ['Без задачи', 'MAIN-1 One'],
        launch_class: ['Сама сессия', 'general'],
        role: ['Основной агент'],
        model: ['Неизвестно', 'model-a'],
      },
    },
  ] as const)('offer «none» by what it admits, and none for a role, in $locale', (example) => {
    expect(offered(example.locale)).toEqual(example.expected)
  })
})
