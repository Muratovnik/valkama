/**
 * The filters' «none» as the read admits it. The oracle is the contract of `none`: it admits work
 * on no item for a task, a session's own run for a launch class, an unknown value for the rest,
 * and nothing for a role, since every stretch has one. So the choice is named by what it admits,
 * and a role offers no such choice at all.
 */
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AnalyticsFilters from '@/pages/analytics/components/AnalyticsFilters.vue'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'
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

/** Every dimension read as the fixture reads it: a list of values for each. */
const allRead = (): Record<UsageDimension, FilterValues> =>
  Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, read(dimension)])) as Record<
    UsageDimension,
    FilterValues
  >

function mountFilters(values: Partial<Record<UsageDimension, FilterValues>>) {
  return mount(AnalyticsFilters, {
    props: { dimensions: DIMENSIONS, filters: {}, values },
    global: { plugins: [analyticsI18n()] },
  })
}

/** The empty label each field would show in its list, in the fields' order. */
const emptyLabels = (filters: VueWrapper) =>
  filters
    .findAllComponents(SearchCombobox)
    .map((field) => (field.props() as { emptyLabel: string }).emptyLabel)

describe('a field whose values are being read', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows nothing for a read that answers inside the delay', async () => {
    const filters = mountFilters({ ...allRead(), work_item: 'loading' })
    expect(emptyLabels(filters)[0]).toBe('')
    vi.advanceTimersByTime(LOADING_DELAY_MS - 1)
    await filters.vm.$nextTick()
    expect(emptyLabels(filters)[0]).toBe('')

    await filters.setProps({ values: allRead() })
    expect(emptyLabels(filters)[0]).toBe('No matches')
  })

  it('shows its word once the wait has lasted, and holds it for the minimum', async () => {
    const filters = mountFilters({ ...allRead(), work_item: 'loading', model: 'failed' })
    vi.advanceTimersByTime(LOADING_DELAY_MS)
    await filters.vm.$nextTick()
    expect(emptyLabels(filters)[0]).toBe('Loading')
    // Another field keeps its own answer, and a failed read says so.
    expect(emptyLabels(filters)[3]).toBe('The values could not be read.')

    await filters.setProps({ values: allRead() })
    // Held for the minimum after the wait was shown, whatever arrived meanwhile.
    expect(emptyLabels(filters)[0]).toBe('Loading')
    vi.advanceTimersByTime(LOADING_MIN_SHOWN_MS - 1)
    await filters.vm.$nextTick()
    expect(emptyLabels(filters)[0]).toBe('Loading')
    vi.advanceTimersByTime(1)
    await filters.vm.$nextTick()
    expect(emptyLabels(filters)[0]).toBe('No matches')
  })
})
