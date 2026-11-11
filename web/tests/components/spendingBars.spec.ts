/**
 * The breakdown of the chosen measure by the chosen dimension. The oracle is the requirement:
 * what lies beyond the rows shown («other»), work on no task and unknown work are three rows,
 * each with its own words, never merged; the adviser and each launch class are rows of their
 * own; each bar is handed its amount in the measure's units; and the bars shown add up to the
 * tile's total.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageRow } from '@/shared/api/analyticsApi.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'

import { noTask, task, unknownTask, usageAnswer, value } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n, mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

const MONDAY = new Date(2026, 10, 9)

/**
 * Twelve tasks, from 12 hours down to 1, then an hour of work on no task and half an hour no one
 * can place; two of the tasks have no price, one with tokens left out.
 */
const STRETCHES: Stretch[] = [
  ...Array.from({ length: 12 }, (_, index) => ({
    day: index % 5,
    group: { work_item: task(index + 1, `Task ${index + 1}`) },
    spend: {
      seconds: (12 - index) * 3600,
      tokens: (12 - index) * 1000,
      cost: index === 0 ? null : (12 - index) * 0.5,
      unpriced: index === 0 ? 57 : 0,
    },
  })),
  { day: 1, group: { work_item: noTask }, spend: { seconds: 3600, tokens: 400, cost: 0.2 } },
  { day: 2, group: { work_item: unknownTask }, spend: { seconds: 1800, tokens: 100, cost: 0.1 } },
]

const answer = (groupBy: UsageDimension[], stretches: readonly Stretch[] = STRETCHES) =>
  usageAnswer({ first: MONDAY, days: 7, groupBy, stretches })

interface MountOptions {
  locale: 'en' | 'ru'
  measure: Measure
  narrow: boolean
}

function mountBars(
  rows: readonly UsageRow[],
  by: UsageDimension,
  { measure = 'time', narrow = false, locale = 'en' }: Partial<MountOptions> = {},
) {
  return mount(SpendingBars, {
    props: { rows, by, measure, narrow },
    global: { plugins: [analyticsI18n(locale)] },
  })
}

const barsOf = (wrapper: ReturnType<typeof mountBars>) =>
  wrapper.getComponent(RankedBars).props('rows') as RankedRow[]

const sum = (rows: readonly RankedRow[]) => rows.reduce((total, row) => total + row.value, 0)

describe('the bars', () => {
  it('rank ten tasks, then fold the rest, then work on no task and unknown work, apart', () => {
    const bars = mountBars(answer(['work_item']).usage.rows, 'work_item')
    const shown = bars.findAll('.ranked-row').map((row) => ({
      kind: row.attributes('data-kind'),
      label: row.get('.ranked-label').text(),
    }))
    expect(shown.slice(0, 10).map((row) => row.label)).toEqual(
      Array.from({ length: 10 }, (_, index) => `MAIN-${index + 1} Task ${index + 1}`),
    )
    expect(shown.slice(10)).toEqual([
      { kind: 'other', label: 'Other, 2 more' },
      { kind: 'none', label: 'No task' },
      { kind: 'unknown', label: 'Unknown' },
    ])
  })

  it('hand each bar its hours, not a share, and the other row the sum of what it folds', () => {
    const rows = barsOf(mountBars(answer(['work_item']).usage.rows, 'work_item'))
    expect(rows.find((row) => row.label === 'MAIN-1 Task 1')?.value).toBe(12)
    expect(rows.find((row) => row.kind === 'other')?.value).toBe(2 + 1)
    expect(rows.find((row) => row.kind === 'none')?.value).toBe(1)
    expect(rows.find((row) => row.kind === 'unknown')?.value).toBe(0.5)
  })

  it.each(['time', 'tokens', 'cost'] as const)('add up to the period total in %s', (measure) => {
    const { usage } = answer(['work_item'])
    const rows = barsOf(mountBars(usage.rows, 'work_item', { measure }))
    const total = {
      time: usage.total.agent_seconds / 3600,
      tokens: usage.total.tokens.input ?? 0,
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

  it('keep the adviser and every launch class as rows of their own, however small', () => {
    const roles = answer(
      ['role'],
      [
        { day: 0, group: { role: value('main') }, spend: { seconds: 40 * 3600 } },
        { day: 0, group: { role: value('subagent') }, spend: { seconds: 20 * 3600 } },
        { day: 0, group: { role: value('advisor') }, spend: { seconds: 60 } },
      ],
    )
    const byRole = mountBars(roles.usage.rows, 'role')
    expect(byRole.findAll('.ranked-label').map((label) => label.text())).toEqual([
      'Main agent',
      'Subagent',
      'Adviser',
    ])
    const classes = answer(
      ['launch_class'],
      Array.from({ length: 13 }, (_, index) => ({
        day: 0,
        group: { launch_class: value(`class-${String(index).padStart(2, '0')}`) },
        spend: { seconds: (index + 1) * 60 },
      })),
    )
    const byClass = mountBars(classes.usage.rows, 'launch_class')
    expect(byClass.findAll('.ranked-row')).toHaveLength(13)
    expect(byClass.find('[data-kind="other"]').exists()).toBe(false)
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
  ] as const)('name no value and unknown by $by in $locale', ({ by, locale, none, unknown }) => {
    const rows = answer(
      [by],
      [
        { day: 0, group: { [by]: CATEGORY[by] }, spend: { seconds: 7200 } },
        { day: 0, group: { [by]: noTask }, spend: { seconds: 3600 } },
        { day: 0, group: { [by]: unknownTask }, spend: { seconds: 1800 } },
      ],
    ).usage.rows
    const shown = mountBars(rows, by, { locale })
      .findAll('.ranked-row')
      .map((row) => [row.attributes('data-kind'), row.get('.ranked-label').text()])
    expect(shown).toEqual([
      ['category', by === 'work_item' ? 'MAIN-1 One' : 'general'],
      ['none', none],
      ['unknown', unknown],
    ])
  })

  it.each(['en', 'ru'] as const)('name every role by its name in %s, none unknown', (locale) => {
    const rows = answer(
      ['role'],
      ['main', 'subagent', 'advisor'].map((role) => ({
        day: 0,
        group: { role: value(role) },
        spend: { seconds: 60 },
      })),
    ).usage.rows
    const bars = mountBars(rows, 'role', { locale })
    expect(bars.findAll('.ranked-row').map((row) => row.attributes('data-kind'))).toEqual([
      'category',
      'category',
      'category',
    ])
    expect(bars.text()).not.toMatch(/Unknown|Неизвестно|No task|Без задачи/u)
  })

  it('read as a table on a narrow page, with the same rows', () => {
    const rows = answer(['work_item']).usage.rows
    const table = mountBars(rows, 'work_item', { narrow: true })
    expect(table.findComponent(RankedBars).exists()).toBe(false)
    expect(table.getComponent(RankedBarsTable).props('rows')).toEqual(
      barsOf(mountBars(rows, 'work_item')),
    )
  })
})

describe('the bars on the page', () => {
  it('break the period down by the dimension the answer was read by, adding up to the tile', async () => {
    stubAnalyticsReads((query) => answer([query.get('group_by') as UsageDimension]))
    const page = await mountAnalytics({ routeState: { measure: 'tokens' } })
    await flushPromises()
    const rows = page.getComponent(RankedBars).props('rows') as RankedRow[]
    expect(page.get('.spending-bars h2').text()).toBe('Tokens by task')
    expect(sum(rows)).toBe(Number(answer(['work_item']).usage.total.tokens.input))
    expect(page.get('.tile-figure[data-measure="tokens"]').text()).toBe('78.5K')
  })
})
