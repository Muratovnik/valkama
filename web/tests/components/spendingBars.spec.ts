/**
 * The breakdown of the chosen measure by the chosen dimension. The oracle is the requirement:
 * every value is a row, none folded, and work on no task and unknown work are rows of their own
 * after them, each with its own words, never merged; the adviser and each launch class are rows
 * of their own; each bar is handed its amount in the measure's units and the hue its value has on
 * the page, the neutral when it has none; and the bars shown add up to the tile's total. The values
 * split one whole, so the section draws them as a ring or as bars, opening on the ring, and on the
 * bars alone where a second dimension splits it; values named by free text, tasks and sessions on
 * either side of a pair, are a list only, the first ten named and the rest folded into one row.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageRow } from '@/shared/api/analyticsApi.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import DonutChart from '@/shared/ui/DonutChart.vue'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'

import { noTask, task, unknownTask, usageAnswer, value } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n, mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { showView, viewsOf } from '../support/chartViews.ts'
import { seriesEntries, seriesNames } from '../support/legend.ts'

const MONDAY = new Date(2026, 10, 9)

/**
 * Ten tasks, from 10 hours down to 1, then an hour of work on no task and half an hour no one
 * can place: twelve values, as many as the list names. Two of the tasks have no price, one with
 * tokens left out.
 */
const STRETCHES: Stretch[] = [
  ...Array.from({ length: 10 }, (_, index) => ({
    day: index % 5,
    group: { work_item: task(index + 1, `Task ${index + 1}`) },
    spend: {
      seconds: (10 - index) * 3600,
      tokens: (10 - index) * 1000,
      cost: index === 0 ? null : (10 - index) * 0.5,
      unpriced: index === 0 ? 57 : 0,
    },
  })),
  { day: 1, group: { work_item: noTask }, spend: { seconds: 3600, tokens: 400, cost: 0.2 } },
  { day: 2, group: { work_item: unknownTask }, spend: { seconds: 1800, tokens: 100, cost: 0.1 } },
]

/**
 * The tokens processed anew, from the stretches themselves: the read splits them by kind and
 * puts ten times as many cache reads beside them, which no figure may count.
 */
const tokensOf = (stretches: readonly Stretch[]) =>
  stretches.reduce((total, stretch) => total + (stretch.spend.tokens ?? 0), 0)

const answer = (groupBy: UsageDimension[], stretches: readonly Stretch[] = STRETCHES) =>
  usageAnswer({ first: MONDAY, days: 7, groupBy, stretches })

interface MountOptions {
  locale: 'en' | 'ru'
  measure: Measure
  narrow: boolean
  slots: ReadonlyMap<string, SeriesSlot>
}

function mountBars(
  rows: readonly UsageRow[],
  by: UsageDimension,
  {
    measure = 'time',
    narrow = false,
    locale = 'en',
    slots = new Map<string, SeriesSlot>(),
  }: Partial<MountOptions> = {},
) {
  return mount(SpendingBars, {
    props: { rows, by, measure, narrow, slots },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

/** The section by a dimension that opens on its ring, turned to its bars as a reader turns it. */
async function mountShownBars(...given: Parameters<typeof mountBars>) {
  const wrapper = mountBars(...given)
  await showView(wrapper, '.spending-bars', 'Bars')
  return wrapper
}

const barsOf = (wrapper: ReturnType<typeof mountBars>) =>
  wrapper.getComponent(RankedBars).props('rows') as RankedRow[]

/**
 * The rows the bars draw for the values they name, by the kind each row declares (`data-kind`),
 * apart from the rest, work on no task and unknown work.
 */
const namedRows = (wrapper: ReturnType<typeof mountBars>) =>
  wrapper.getComponent(RankedBars).findAll('[data-kind="category"]')

const sum = (rows: readonly RankedRow[]) => rows.reduce((total, row) => total + row.value, 0)

describe('the bars', () => {
  it('rank every task, none folded, then work on no task and unknown work, apart', () => {
    const bars = mountBars(answer(['work_item']).usage.rows, 'work_item')
    const shown = bars.findAll('.ranked-row').map((row) => ({
      kind: row.attributes('data-kind'),
      label: row.get('.ranked-label').text(),
    }))
    expect(shown.slice(0, 10).map((row) => row.label)).toEqual(
      Array.from({ length: 10 }, (_, index) => `MAIN-${index + 1} Task ${index + 1}`),
    )
    expect(shown.slice(10)).toEqual([
      { kind: 'none', label: 'No task' },
      { kind: 'unknown', label: 'Unknown' },
    ])
  })

  it('hand each bar its hours, not a share', () => {
    const rows = barsOf(mountBars(answer(['work_item']).usage.rows, 'work_item'))
    expect(rows.find((row) => row.label === 'MAIN-1 Task 1')?.value).toBe(10)
    expect(rows.find((row) => row.label === 'MAIN-10 Task 10')?.value).toBe(1)
    expect(rows.find((row) => row.kind === 'none')?.value).toBe(1)
    expect(rows.find((row) => row.kind === 'unknown')?.value).toBe(0.5)
  })

  it('draw each bar in the hue its value has on the page, and the neutral without one', () => {
    // A value's key is its id behind `v:`, as the page keys a value's line.
    const slots = new Map<string, SeriesSlot>([
      [`v:${task(1, 'Task 1').id}`, 4],
      [`v:${task(2, 'Task 2').id}`, 1],
    ])
    const rows = barsOf(mountBars(answer(['work_item']).usage.rows, 'work_item', { slots }))
    expect(rows.find((row) => row.label === 'MAIN-1 Task 1')?.slot).toBe(4)
    expect(rows.find((row) => row.label === 'MAIN-2 Task 2')?.slot).toBe(1)
    expect(rows.find((row) => row.label === 'MAIN-3 Task 3')?.slot).toBe('other')
  })

  it.each(['time', 'tokens', 'cost'] as const)('add up to the period total in %s', (measure) => {
    const { usage } = answer(['work_item'])
    const rows = barsOf(mountBars(usage.rows, 'work_item', { measure }))
    const total = {
      time: usage.total.agent_seconds / 3600,
      tokens: tokensOf(STRETCHES),
      cost: usage.total.estimated_api_cost_usd ?? 0,
    }[measure]
    expect(sum(rows)).toBeCloseTo(total, 9)
  })

  it('say a cost with no price as the tokens it leaves out, never a zero', () => {
    // Three tasks, so the one with no price, last by cost, is still named rather than folded.
    const few = answer(['work_item'], STRETCHES.slice(0, 3))
    const rows = barsOf(mountBars(few.usage.rows, 'work_item', { measure: 'cost' }))
    const unpriced = rows.find((row) => row.label === 'MAIN-1 Task 1')
    expect(unpriced?.valueText).toBe('57 tokens without a price')
    expect(unpriced?.value).toBe(0)
  })

  it('keep the adviser and every launch class as rows of their own, however small', async () => {
    const roles = answer(
      ['role'],
      [
        { day: 0, group: { role: value('main') }, spend: { seconds: 40 * 3600 } },
        { day: 0, group: { role: value('subagent') }, spend: { seconds: 20 * 3600 } },
        { day: 0, group: { role: value('advisor') }, spend: { seconds: 60 } },
      ],
    )
    const byRole = await mountShownBars(roles.usage.rows, 'role')
    expect(byRole.findAll('.ranked-label').map((label) => label.text())).toEqual([
      'Main agent',
      'Subagent',
      'Adviser',
    ])
    const classes = answer(
      ['launch_class'],
      Array.from({ length: 12 }, (_, index) => ({
        day: 0,
        group: { launch_class: value(`class-${String(index).padStart(2, '0')}`) },
        spend: { seconds: (index + 1) * 60 },
      })),
    )
    const byClass = await mountShownBars(classes.usage.rows, 'launch_class')
    expect(namedRows(byClass)).toHaveLength(12)
    expect(byClass.find('[data-kind="other"]').exists()).toBe(false)
  })

  it('name the first ten tasks, fold the rest into one row and leave them to the table, in one line that asks for it', async () => {
    const many = (count: number) =>
      answer(
        ['work_item'],
        Array.from({ length: count }, (_, index) => ({
          day: 0,
          group: { work_item: task(index + 1, `Task ${index + 1}`) },
          spend: { seconds: (count - index) * 600 },
        })),
      ).usage.rows
    const ten = mountBars(many(10), 'work_item')
    expect(namedRows(ten)).toHaveLength(10)
    expect(ten.find('[data-kind="other"]').exists()).toBe(false)
    expect(ten.find('.spending-bars-more').exists()).toBe(false)

    const thirty = mountBars(many(30), 'work_item')
    const labels = thirty.findAll('.ranked-row .ranked-label').map((label) => label.text())
    expect(labels).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `MAIN-${index + 1} Task ${index + 1}`),
      'Other, 20 more',
    ])
    // The twenty folded add up to the rest's figure: 20 tasks of 10 down to 1 times ten minutes.
    expect(barsOf(thirty).find((row) => row.kind === 'other')?.value).toBeCloseTo(
      (210 * 600) / 3600,
    )
    const more = thirty.get('.spending-bars-more')
    expect(more.text()).toBe('20 more — in the table')
    await more.trigger('click')
    expect(thirty.emitted('more')).toHaveLength(1)
    expect(
      mountBars(many(30), 'work_item', { locale: 'ru' }).get('.spending-bars-more').text(),
    ).toBe('ещё 20 — в таблице')
  })

  const CATEGORY = { work_item: task(1, 'One'), launch_class: value('general') }

  // The words come from the contract: work with no value is no task for a task and a session's
  // own run for a launch class; «unknown» is what the store cannot place, and a role is never
  // either.
  it.each([
    { by: 'work_item', locale: 'en', none: 'No task', unknown: 'Unknown' },
    { by: 'work_item', locale: 'ru', none: 'Без задачи', unknown: 'Неизвестно' },
    { by: 'launch_class', locale: 'en', none: 'The session itself', unknown: 'Unknown' },
    { by: 'launch_class', locale: 'ru', none: 'Сама сессия', unknown: 'Неизвестно' },
  ] as const)(
    'name no value and unknown by $by in $locale',
    async ({ by, locale, none, unknown }) => {
      const rows = answer(
        [by],
        [
          { day: 0, group: { [by]: CATEGORY[by] }, spend: { seconds: 7200 } },
          { day: 0, group: { [by]: noTask }, spend: { seconds: 3600 } },
          { day: 0, group: { [by]: unknownTask }, spend: { seconds: 1800 } },
        ],
      ).usage.rows
      const bars = mountBars(rows, by, { locale })
      if (by !== 'work_item')
        await showView(bars, '.spending-bars', locale === 'en' ? 'Bars' : 'Полосы')
      const shown = bars
        .findAll('.ranked-row')
        .map((row) => [row.attributes('data-kind'), row.get('.ranked-label').text()])
      expect(shown).toEqual([
        ['category', by === 'work_item' ? 'MAIN-1 One' : 'general'],
        ['none', none],
        ['unknown', unknown],
      ])
    },
  )

  it.each(['en', 'ru'] as const)(
    'name every role by its name in %s, none unknown',
    async (locale) => {
      const rows = answer(
        ['role'],
        ['main', 'subagent', 'advisor'].map((role) => ({
          day: 0,
          group: { role: value(role) },
          spend: { seconds: 60 },
        })),
      ).usage.rows
      const bars = mountBars(rows, 'role', { locale })
      await showView(bars, '.spending-bars', locale === 'en' ? 'Bars' : 'Полосы')
      expect(bars.findAll('.ranked-row').map((row) => row.attributes('data-kind'))).toEqual([
        'category',
        'category',
        'category',
      ])
      expect(bars.text()).not.toMatch(/Unknown|Неизвестно|No task|Без задачи/u)
    },
  )

  it('read as a table on a narrow page, with the same rows', () => {
    const rows = answer(['work_item']).usage.rows
    const table = mountBars(rows, 'work_item', { narrow: true })
    expect(table.findComponent(RankedBars).exists()).toBe(false)
    expect(table.getComponent(RankedBarsTable).props('rows')).toEqual(
      barsOf(mountBars(rows, 'work_item')),
    )
  })

  // With no row, nothing was spent: neither a figure («0 min») nor an absent one («No price»).
  it('say a period that spent nothing spent nothing, in every measure and as a table', () => {
    for (const measure of ['time', 'tokens', 'cost'] as const) {
      expect(mountBars([], 'work_item', { measure }).text()).toContain(
        'This period spent nothing to break down.',
      )
      expect(mountBars([], 'work_item', { measure, narrow: true }).text()).toContain(
        'This period spent nothing to break down.',
      )
    }
    expect(mountBars([], 'work_item', { locale: 'ru' }).text()).toContain(
      'В этом периоде нечего разбивать: ничего не потрачено.',
    )
  })
})

describe('the bars on the page', () => {
  it('break the period down by the dimension the answer was read by, adding up to the tile', async () => {
    stubAnalyticsReads((query) => answer([query.get('group_by') as UsageDimension]))
    const page = await mountAnalytics({ routeState: { by: 'work_item', measure: 'tokens' } })
    await flushPromises()
    const rows = page.getComponent(RankedBars).props('rows') as RankedRow[]
    expect(page.get('.spending-bars h3').text()).toBe('Tokens by task')
    expect(sum(rows)).toBe(tokensOf(STRETCHES))
    expect(page.get('.tile-figure[data-measure="tokens"]').text()).toBe('55.5K')
  })
})

/**
 * An account is an organization's id, which no store names: the page names it by the start of
 * the id, as an item's card does, so the same account reads the same everywhere, and keeps the
 * whole id for its hint and its table. Work no organization was recorded for stays unknown.
 */
describe('the bars by account', () => {
  const FIRST = '3f9a1b2c-5d6e-4f70-8a9b-0c1d2e3f4a5b'
  const SECOND = '77de0a1c-1111-4222-8333-444455556666'
  const accounts = answer(
    ['account'],
    [
      { day: 0, group: { account: value(FIRST) }, spend: { seconds: 3 * 3600 } },
      { day: 1, group: { account: value(SECOND) }, spend: { seconds: 2 * 3600 } },
      { day: 2, group: { account: { id: null, unknown: true } }, spend: { seconds: 3600 } },
    ],
  )

  it('name each by the start of its id and keep the whole id for its hint and its table', async () => {
    const bars = await mountShownBars(accounts.usage.rows, 'account')

    expect(barsOf(bars).map((row) => [row.label, row.detail])).toEqual([
      ['3f9a1b2c', FIRST],
      ['77de0a1c', SECOND],
      ['Unknown', undefined],
    ])
    expect(bars.text()).not.toContain(FIRST)
  })

  it('say the whole id under the name in the table', () => {
    const table = mountBars(accounts.usage.rows, 'account', { narrow: true })

    expect(
      table
        .getComponent(RankedBarsTable)
        .findAll('th[scope="row"]')
        .map((name) => name.text()),
    ).toEqual([`3f9a1b2c${FIRST}`, `77de0a1c${SECOND}`, 'Unknown'])
  })
})

/**
 * The two drawings of the split and the table, switched in the section's heading. The oracle is
 * the rule of `firstSplitView` as the owner set it: a ring, except where the parts are as many as
 * the tasks, which open on their bars; a section split by a second dimension draws bars alone; a
 * narrow page starts on the table; and every view reads the same figures.
 */
/** Text as it reads, the narrow spaces in a figure as plain ones. */
const spaced = (text: string) => text.replaceAll(/\s+/gu, ' ')

describe('the drawings of the split', () => {
  const MODELS = answer(
    ['model'],
    [
      { day: 0, group: { model: value('model-a') }, spend: { seconds: 3 * 3600 } },
      { day: 1, group: { model: value('model-b') }, spend: { seconds: 2 * 3600 } },
      { day: 2, group: { model: value('model-c') }, spend: { seconds: 3600 } },
    ],
  ).usage.rows
  /** Each model's hue on the page, as the page hands them to the section. */
  const slots = new Map<string, SeriesSlot>([
    ['v:model-a', 1],
    ['v:model-b', 2],
    ['v:model-c', 3],
  ])

  it('opens a dimension named by identifiers on its ring', () => {
    const byModel = mountBars(MODELS, 'model')
    expect(viewsOf(byModel, '.spending-bars')).toEqual({
      offered: ['Ring', 'Bars', 'Table'],
      shown: 'Ring',
    })
    expect(byModel.findComponent(DonutChart).exists()).toBe(true)
    expect(byModel.findComponent(RankedBars).exists()).toBe(false)
  })

  it('reads the same figures as a ring, as bars and as a table', async () => {
    const section = mountBars(MODELS, 'model', { slots })
    const ring = seriesEntries(section).map((one) => spaced(one.text()))
    // Each part its name, then its figure and its bare share at the end of its line.
    expect(ring).toEqual(['model-a3 h · 50%', 'model-b2 h · 33%', 'model-c1 h · 17%'])

    await showView(section, '.spending-bars', 'Bars')
    expect(barsOf(section).map((row) => [row.label, spaced(row.valueText)])).toEqual([
      ['model-a', '3 h'],
      ['model-b', '2 h'],
      ['model-c', '1 h'],
    ])
    await showView(section, '.spending-bars', 'Table')
    expect(
      section
        .getComponent(RankedBarsTable)
        .findAll('tbody tr')
        .map((row) => spaced(row.text())),
    ).toEqual(['model-a3 h', 'model-b2 h', 'model-c1 h'])
    // Back to the ring, which the reader chose last: the choice stands.
    await showView(section, '.spending-bars', 'Ring')
    expect(viewsOf(section, '.spending-bars').shown).toBe('Ring')
  })

  it('draws a section split by a second dimension as bars alone, and starts a narrow page on the table', async () => {
    const split = mount(SpendingBars, {
      props: {
        rows: answer(
          ['model', 'effort'],
          [
            {
              day: 0,
              group: { model: value('model-a'), effort: value('high') },
              spend: { seconds: 60 },
            },
          ],
        ).usage.rows,
        by: 'model',
        across: 'effort',
        measure: 'time',
        narrow: false,
        slots: new Map<string, SeriesSlot>(),
      },
      global: { plugins: [analyticsI18n('en')] },
    })
    expect(viewsOf(split, '.spending-bars')).toEqual({ offered: ['Bars', 'Table'], shown: 'Bars' })
    expect(split.findComponent(DonutChart).exists()).toBe(false)

    const narrow = mountBars(MODELS, 'model', { narrow: true })
    expect(viewsOf(narrow, '.spending-bars').shown).toBe('Table')
    expect(narrow.findComponent(DonutChart).exists()).toBe(false)
  })

  it('leaves no value to the table under the ring, and the first twelve to the bars', async () => {
    const many = answer(
      ['model'],
      Array.from({ length: 14 }, (_, index) => ({
        day: 0,
        group: { model: value(`model-${String(index).padStart(2, '0')}`) },
        spend: { seconds: (14 - index) * 60 },
      })),
    ).usage.rows
    const section = mountBars(many, 'model')
    // The ring folds its own rest: no line asks for the table.
    expect(section.text()).not.toContain('2 more in the table')
    expect(seriesNames(section).at(-1)).toMatch(/^Other, \d+ more$/u)
    await showView(section, '.spending-bars', 'Bars')
    expect(namedRows(section)).toHaveLength(12)
    expect(section.text()).toContain('2 more')
  })
})
