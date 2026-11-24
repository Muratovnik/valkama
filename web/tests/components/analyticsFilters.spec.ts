/**
 * The filter on the Analytics bar, through its menu: the dimensions, each dimension's values, and
 * what the menu reads and says while they are read. The oracles are the page's contract:
 * - «none» admits work on no item for a task, a session's own run for a launch class, an unknown
 *   value for the rest, and nothing for a role, since every stretch has one; so the choice is named
 *   by what it admits, and a role offers no such choice at all;
 * - a dimension's values are read only when the menu shows them: none while it is closed or on the
 *   dimensions, the one stepped into, every one while typed text searches them all;
 * - a wait is said once it has lasted and held for the minimum, a failed read says so, and a read
 *   that answers inside the delay says nothing;
 * - a value a link names that the period did not spend stays chosen, under its id;
 * - a chip never says its value's id before its dimension's read names it: it says the
 *   dimension and «…» before the first answer, and the name it had while read again.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AnalyticsBar from '@/pages/analytics/components/AnalyticsBar.vue'
import type { FilterValues } from '@/pages/analytics/composables/useUsageRead.ts'

import { DEFAULT_VIEW } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'
import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'

import { task, usageAnswer, value } from '../fixtures/analytics.ts'
import {
  chosenRows,
  menuNote,
  menuRows,
  openDimension,
  openFilter,
  pressRow,
} from '../support/analyticsFilter.ts'
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

/** Every dimension read as the fixture reads it: a list of values for each. */
const allRead = (): Record<UsageDimension, FilterValues> =>
  Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, read(dimension)])) as Record<
    UsageDimension,
    FilterValues
  >

function mountChips(
  values: Partial<Record<UsageDimension, FilterValues>> = allRead(),
  filters: UsageFilters = {},
  locale: 'en' | 'ru' = 'en',
) {
  return mount(AnalyticsBar, {
    props: {
      dimensions: DIMENSIONS,
      filtersRefused: '',
      lastEventAt: undefined,
      live: false,
      readFailed: false,
      today: '2026-11-11',
      values,
      view: { ...DEFAULT_VIEW, filters },
    },
    attachTo: document.body,
    global: { plugins: [analyticsI18n(locale)] },
  })
}

/** The page's filters set anew, as the bar's host hands them back. */
const setFilters = (chips: ReturnType<typeof mountChips>, filters: UsageFilters) =>
  chips.setProps({ view: { ...DEFAULT_VIEW, filters } })

type Chips = ReturnType<typeof mountChips>

/** What each chip in the bar says. */
const chipWords = (chips: Chips) =>
  chips.findAll('.analytics-bar-chips [data-filter-chip]').map((chip) => chip.text())

/** The dimensions' rows, as the menu opens on them. */
async function dimensionRows(chips: Chips) {
  await openFilter(chips)
  return menuRows(chips)
}

/** The values the menu offers in each dimension, stepped into one after another. */
async function offered(locale: 'en' | 'ru') {
  const names = await dimensionRows(mountChips(allRead(), {}, locale))
  const found: Record<string, string[]> = {}
  for (const [place, dimension] of DIMENSIONS.entries()) {
    const chips = mountChips(allRead(), {}, locale)
    await openDimension(chips, names[place] ?? '')
    found[dimension] = menuRows(chips)
    chips.unmount()
  }
  return found
}

/** The dimensions each `need` asked for, in order. */
const needs = (chips: Chips) =>
  chips.emitted<[UsageDimension[]]>('need')?.map(([dimensions]) => dimensions) ?? []

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the filter’s menu', () => {
  it.each([
    {
      locale: 'en',
      dimensions: ['Task', 'Launch class', 'Role', 'Model'],
      expected: {
        work_item: ['No task', 'MAIN-1 One'],
        launch_class: ['The session itself', 'general'],
        role: ['Main agent'],
        model: ['Unknown', 'model-a'],
      },
    },
    {
      locale: 'ru',
      dimensions: ['Задача', 'Способ запуска', 'Роль', 'Модель'],
      expected: {
        work_item: ['Без задачи', 'MAIN-1 One'],
        launch_class: ['Сама сессия', 'general'],
        role: ['Основной агент'],
        model: ['Неизвестно', 'model-a'],
      },
    },
  ] as const)(
    'opens on the dimensions and offers «none» by what it admits, none for a role, in $locale',
    async (example) => {
      expect(await dimensionRows(mountChips(allRead(), {}, example.locale))).toEqual(
        example.dimensions,
      )
      expect(await offered(example.locale)).toEqual(example.expected)
    },
  )

  it('asks for no values while closed or on the dimensions, then for the one stepped into', async () => {
    const chips = mountChips()
    expect(needs(chips)).toEqual([])
    await openFilter(chips)
    expect(needs(chips)).toEqual([])
    await openDimension(chips, 'Model')
    expect(needs(chips)).toEqual([['model']])
  })

  it('asks for every dimension’s values while typed text searches them all', async () => {
    const chips = mountChips()
    await openFilter(chips)
    await chips.get('.analytics-filter-add input').setValue('mod')
    expect(needs(chips)).toEqual([DIMENSIONS])
    // The search finds a value of any dimension: the model's word, and every value of the
    // dimension whose name holds it.
    expect(menuRows(chips)).toEqual(['Unknown', 'model-a'])
  })

  it('puts a value in its filter and takes it out, as its row is pressed', async () => {
    const chips = mountChips()
    await openDimension(chips, 'Model')
    await pressRow(chips, 'model-a')
    expect(chips.emitted('filter')?.at(-1)).toEqual(['model', ['model-a']])
    await setFilters(chips, { model: ['model-a'] })
    expect(chosenRows(chips)).toEqual(['model-a'])
    await pressRow(chips, 'Unknown')
    expect(chips.emitted('filter')?.at(-1)).toEqual(['model', ['model-a', null]])
    await setFilters(chips, { model: ['model-a', null] })
    await pressRow(chips, 'model-a')
    expect(chips.emitted('filter')?.at(-1)).toEqual(['model', [null]])
  })

  it('keeps a value a link names that the period did not spend, chosen under its id', async () => {
    const chips = mountChips(allRead(), { model: ['model-gone'] })
    expect(
      chips.findAll('.analytics-bar-chips [data-filter-chip]').map((chip) => chip.text()),
    ).toEqual(['Model: model-gone'])
    await openDimension(chips, 'Model')
    // Its control: the values the period spent are offered unchosen beside it.
    expect(menuRows(chips)).toEqual(['Unknown', 'model-a', 'model-gone'])
    expect(chosenRows(chips)).toEqual(['model-gone'])
  })
})

describe('a dimension whose values are being read', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says nothing for a read that answers inside the delay', async () => {
    const chips = mountChips({ ...allRead(), work_item: 'loading' })
    await openDimension(chips, 'Task')
    expect(menuNote(chips).exists()).toBe(false)
    vi.advanceTimersByTime(LOADING_DELAY_MS - 1)
    await chips.vm.$nextTick()
    expect(menuNote(chips).exists()).toBe(false)

    await chips.setProps({ values: allRead() })
    expect(menuNote(chips).exists()).toBe(false)
    expect(menuRows(chips)).toEqual(['No task', 'MAIN-1 One'])
  })

  it('says its word once the wait has lasted, and holds it for the minimum', async () => {
    const chips = mountChips({ ...allRead(), work_item: 'loading' })
    await openDimension(chips, 'Task')
    vi.advanceTimersByTime(LOADING_DELAY_MS)
    await chips.vm.$nextTick()
    expect(menuNote(chips).text()).toBe('Loading')

    await chips.setProps({ values: allRead() })
    // Held for the minimum after the wait was shown, whatever arrived meanwhile.
    expect(menuNote(chips).text()).toBe('Loading')
    vi.advanceTimersByTime(LOADING_MIN_SHOWN_MS - 1)
    await chips.vm.$nextTick()
    expect(menuNote(chips).text()).toBe('Loading')
    vi.advanceTimersByTime(1)
    await chips.vm.$nextTick()
    expect(menuNote(chips).exists()).toBe(false)
    expect(menuRows(chips)).toEqual(['No task', 'MAIN-1 One'])
  })

  it('says a read that failed, in the dimension that failed alone', async () => {
    const chips = mountChips({ ...allRead(), model: 'failed' })
    await openDimension(chips, 'Model')
    expect(menuNote(chips).text()).toBe('The values could not be loaded.')
    // Its control: another dimension keeps its own answer.
    const other = mountChips({ ...allRead(), model: 'failed' })
    await openDimension(other, 'Role')
    expect(menuNote(other).exists()).toBe(false)
    expect(menuRows(other)).toEqual(['Main agent'])
  })
})

describe('a chip while its value’s name is read', () => {
  const TASK = task(1, 'One').id ?? ''

  it('says its dimension and no id before the first answer, then the name', async () => {
    const chips = mountChips({}, { work_item: [TASK] })
    expect(chipWords(chips)).toEqual(['Task: …'])
    await chips.setProps({ values: { work_item: 'loading' } })
    expect(chipWords(chips)).toEqual(['Task: …'])
    await chips.setProps({ values: allRead() })
    expect(chipWords(chips)).toEqual(['Task: MAIN-1 One'])
  })

  it('keeps the name it had while its dimension is read again for another period', async () => {
    const chips = mountChips(allRead(), { work_item: [TASK] })
    expect(chipWords(chips)).toEqual(['Task: MAIN-1 One'])
    // A new period drops what was offered, then reads it again.
    await chips.setProps({ values: {} })
    expect(chipWords(chips)).toEqual(['Task: MAIN-1 One'])
    await chips.setProps({ values: { work_item: 'loading' } })
    expect(chipWords(chips)).toEqual(['Task: MAIN-1 One'])
    await chips.setProps({ values: { work_item: 'failed' } })
    expect(chipWords(chips)).toEqual(['Task: MAIN-1 One'])
  })

  it('says the name its id gives before the first answer, where no read is needed', () => {
    // A role's is its words, never its id «main»; a model's id is its name, as it was.
    expect(chipWords(mountChips({}, { role: ['main'], model: ['model-a'] }))).toEqual([
      'Role: Main agent',
      'Model: model-a',
    ])
  })

  it('says «none» by its words, and the id after a read that failed with no name before', () => {
    // Its controls: a value named without a read, and the one place an id still stands.
    expect(chipWords(mountChips({}, { work_item: [null] }))).toEqual(['Task: No task'])
    expect(chipWords(mountChips({ work_item: 'failed' }, { work_item: [TASK] }))).toEqual([
      `Task: ${TASK}`,
    ])
  })
})
