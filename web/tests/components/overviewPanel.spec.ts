/**
 * The overview of the Analytics page, where the page opens. The oracle is the requirement: the
 * figures choose the measure and say a steep rise from the little it rose from; the chart holds
 * the period before as an outline, in the table too, and a single day by the hour; what changed
 * names the tasks that moved most; a card of first values for tasks, models, roles and projects,
 * no projects at a project's scope; and each part that could not be read says so in its place,
 * leaving the rest.
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'

import {
  figuresAnswer,
  momentAt,
  noTask,
  serveUsage,
  task,
  usageAnswer,
  value,
} from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { analyticsI18n, mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)
const MONDAY = new Date(2026, 10, 9)

const ONE = task(1, 'One')
const TWO = task(2, 'Two')

/**
 * This week an hour on One and two on Two; the Monday of the week before two hours on One. So
 * Two rose by two hours from nothing and One fell by an hour.
 */
const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 9, 10),
    group: {
      work_item: ONE,
      model: value('model-a'),
      project: value('alpha'),
      role: value('main'),
    },
    spend: { seconds: 3600 },
  },
  {
    at: new Date(2026, 10, 10, 10),
    group: {
      work_item: TWO,
      model: value('model-b'),
      project: value('beta'),
      role: value('review'),
    },
    spend: { seconds: 7200 },
  },
  {
    at: new Date(2026, 10, 2, 10),
    group: {
      work_item: ONE,
      model: value('model-a'),
      project: value('alpha'),
      role: value('main'),
    },
    spend: { seconds: 7200 },
  },
]

/** The same days of the week before, which the page reads beside this week. */
const weekBefore = (query: URLSearchParams) =>
  (query.get('from')?.includes('T') ?? false) && query.get('group_by') === 'work_item'
/** The period before step by step, which the chart outlines: a read by nothing. */
const outline = (query: URLSearchParams) => !query.get('group_by')

const cards = (page: VueWrapper) =>
  page.findAll('.overview-top').map((one) => one.attributes('data-card'))
const card = (page: VueWrapper, dimension: string) => page.get(`[data-card="${dimension}"]`)
const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the overview on the page', () => {
  it('asks each card its own read, but the tasks, which are the overview’s own answer', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    // The roles have no card: the rail's tile says both.
    expect(cards(page)).toEqual(['work_item', 'model', 'project'])
    // This week and the same days of the week before, by task, the first shared with the rail's
    // tile of tasks; nothing more for the tasks' card.
    expect(reads.grouped('work_item')).toHaveLength(2)
    // Each card's read, the same as the rail's tile of that dimension and read once for both;
    // the roles' read is the rail's tile's alone.
    for (const dimension of ['model', 'role', 'project'])
      expect(reads.grouped(dimension), dimension).toHaveLength(1)
    expect(reads.asked.filter((query) => outline(query))).toHaveLength(1)
    expect(words(card(page, 'model').text())).toContain('model-b')
  })

  it('leaves a value with nothing in the period out of its card', async () => {
    // Four models with time this week, a fifth with tokens and no time at all.
    const models: TimedStretch[] = [1, 2, 3, 4, 0].map((hours, index) => ({
      at: new Date(2026, 10, 9, 10 + index),
      group: { work_item: ONE, model: value(`model-${index}`) },
      spend: { seconds: hours * 3600, tokens: 100 },
    }))
    stubAnalyticsReads((query) => serveUsage(models, query))
    const page = await mountAnalytics()
    const rows = card(page, 'model').findAll('.ranked-row')
    expect(rows).toHaveLength(4)
    expect(words(card(page, 'model').text())).not.toContain('model-4')
  })

  it('ranks work on no task in the tasks’ card by its figure, neutral, quiet and leading nowhere', async () => {
    const onNoTask: TimedStretch = {
      at: new Date(2026, 10, 10, 12),
      group: { work_item: noTask },
      spend: { seconds: 3 * 3600 },
    }
    stubAnalyticsReads((query) => serveUsage([...WORLD, onNoTask], query))
    const page = await mountAnalytics()
    const rows = card(page, 'work_item').findAll('.ranked-line')
    // Three hours on no task, two on Two, one on One: no task first, by its figure.
    expect(rows.map((row) => row.attributes('data-key'))).toEqual([
      'none',
      `v:${TWO.id}`,
      `v:${ONE.id}`,
    ])
    const [none, two, one] = rows
    expect(none?.attributes('href')).toBeUndefined()
    expect(none?.get('.ranked-label').classes()).toContain('ranked-quiet')
    expect(none?.get('.ranked-bar').attributes('data-slot')).toBe('apart')
    // The tasks in their hues of the page, by their rank among the tasks.
    expect(two?.get('.ranked-bar').attributes('data-slot')).toBe('1')
    expect(one?.get('.ranked-bar').attributes('data-slot')).toBe('2')
  })

  it('leaves the projects out at a project’s scope, where every figure is that project’s', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ projectId: 'alpha' })
    expect(cards(page)).toEqual(['work_item', 'model'])
    expect(reads.grouped('project')).toHaveLength(0)
  })

  it('names what moved most from the week before, in the measure’s own units', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    const lines = page.findAll('.overview-changes-line')
    const part = (line: (typeof lines)[number], name: string) =>
      line.find(`.overview-changes-${name}`).exists()
        ? words(line.get(`.overview-changes-${name}`).text())
        : ''
    // The sign stands a thin space from the amount, as the figures' own spacing has it.
    expect(
      lines.map((one) => [
        one.attributes('data-way'),
        part(one, 'name'),
        part(one, 'amount'),
        part(one, 'note'),
      ]),
    ).toEqual([
      ['up', 'MAIN-2 Two', '+ 2 h', 'Nothing before'],
      ['down', 'MAIN-1 One', '− 1 h', ''],
    ])
  })

  it('says a card could not be read in that card and shows the others', async () => {
    stubAnalyticsReads((query) =>
      query.get('group_by') === 'model' ? { status: 500 } : serveUsage(WORLD, query),
    )
    const page = await mountAnalytics()
    expect(words(card(page, 'model').text())).toContain('The values could not be read.')
    expect(card(page, 'project').findAll('.ranked-row')).toHaveLength(2)
  })

  it('says the week before was not read where the changes stand, and reads it again', async () => {
    let failing = true
    const reads = stubAnalyticsReads((query) =>
      failing && weekBefore(query) ? { status: 500 } : serveUsage(WORLD, query),
    )
    const page = await mountAnalytics()
    const changes = page.get('.overview-changes')
    expect(words(changes.text())).toContain(
      'The period before could not be read, so nothing is compared.',
    )
    expect(changes.findAll('.overview-changes-line')).toHaveLength(0)

    failing = false
    const asked = reads.asked.filter((query) => weekBefore(query)).length
    await changes.get('button').trigger('click')
    await flushPromises()
    expect(reads.asked.filter((query) => weekBefore(query)).length).toBeGreaterThan(asked)
    expect(page.findAll('.overview-changes-line')).toHaveLength(2)
  })

  it('says the outline could not be read under the chart, and draws the period alone', async () => {
    stubAnalyticsReads((query) => (outline(query) ? { status: 500 } : serveUsage(WORLD, query)))
    const page = await mountAnalytics()
    const days = page.get('.spending-days')
    expect(words(days.text())).toContain(
      'The period before could not be read, so it is not outlined.',
    )
    expect(days.findAll('.period-before')).toHaveLength(0)
    expect(days.findAll('.period-column')).toHaveLength(3)
  })
})

describe('the period before on the overview', () => {
  /**
   * Half an hour on the evening before the past four weeks begin: inside the period of their
   * length right before them, which their figures are compared with, and outside the same days
   * four weeks back, which end at this afternoon's hour.
   */
  const EVENING: TimedStretch = {
    at: new Date(2026, 9, 14, 18),
    group: {
      work_item: ONE,
      model: value('model-a'),
      project: value('alpha'),
      role: value('main'),
    },
    spend: { seconds: 1800 },
  }
  const span = (period: { from: string; to: string }) => [
    Date.parse(period.from),
    Date.parse(period.to),
  ]

  for (const [name, routeState] of [
    ['this week', {}],
    ['the past four weeks', { period: 'weeks4' }],
    ['a custom range', { period: 'custom', from: '2026-11-03', to: '2026-11-11' }],
  ] as const)
    it(`is one period for the figures and the outline: ${name}`, async () => {
      const served: ReturnType<typeof serveUsage>['usage'][] = []
      stubAnalyticsReads((query) => {
        const answer = serveUsage([...WORLD, EVENING], query)
        served.push(answer.usage)
        return answer
      })
      const page = await mountAnalytics({ routeState })
      // What the figures are compared with, as the tiles hold it.
      const cells = page.findComponent(SpendingTiles).props('usage').comparison
      if (!cells) throw new Error('the tiles compare with nothing')
      const shown = served[0]?.period
      if (!shown) throw new Error('the page read nothing')
      // Every read of a period before the one shown is of the period the figures compare with.
      const earlier = served.filter(
        (usage) => Date.parse(usage.period.to) <= Date.parse(shown.from),
      )
      expect(earlier.length).toBeGreaterThan(0)
      for (const usage of earlier) expect(span(usage.period)).toEqual(span(cells.period))
      // And the outline adds up to the figure the tiles compare with.
      const outlined = page.findComponent(SpendingDays).props('before')
      expect(Array.isArray(outlined), `the outline stands at ${String(outlined)}`).toBe(true)
      const steps = Array.isArray(outlined) ? outlined : []
      const seconds = steps.reduce((sum, step) => sum + step.agent_seconds, 0)
      expect(seconds).toBe(cells.total.agent_seconds)
    })
})

describe('the overview’s chart', () => {
  it('holds the period before in a column of the table, step by step', () => {
    const usage = usageAnswer({
      first: MONDAY,
      days: 3,
      end: NOW,
      groupBy: ['work_item'],
      stretches: [{ day: 0, group: { work_item: ONE }, spend: { seconds: 3600 } }],
    }).usage
    const before = usageAnswer({
      first: new Date(2026, 10, 2),
      days: 3,
      groupBy: [],
      stretches: [
        { day: 0, group: {}, spend: { seconds: 7200 } },
        { day: 1, group: {}, spend: { seconds: 1800 } },
      ],
    }).usage.series
    const days = mount(SpendingDays, {
      props: {
        usage,
        before,
        by: 'work_item',
        measure: 'time',
        narrow: true,
        readAt: NOW,
        accounts: 'loading',
      },
      global: { plugins: [analyticsI18n()] },
    })
    const headings = days.findAll('thead th').map((one) => one.text())
    const at = headings.indexOf('period before')
    expect(at).toBeGreaterThan(headings.indexOf('Total'))
    const column = days
      .findAll('tbody tr')
      .map((row) => words(row.element.children.item(at)?.textContent ?? ''))
    // A zero reads as every zero of agent time on the page does, in its unit.
    expect(column).toEqual(['2 h', '30 min', '0 min'])
  })

  it('stands a single day by the hour, and an hour is not a day to narrow the view to', () => {
    const query = new URLSearchParams({
      from: '2026-11-10',
      to: '2026-11-11',
      utc_offset: String(-MONDAY.getTimezoneOffset()),
      step: 'hour',
      group_by: 'work_item',
    })
    const { usage } = serveUsage(WORLD, query)
    const days = mount(SpendingDays, {
      props: {
        usage,
        by: 'work_item',
        measure: 'time',
        narrow: false,
        readAt: NOW,
        accounts: 'loading',
      },
      global: { plugins: [analyticsI18n()] },
    })
    expect(days.text()).toContain('Agent time per hour, by task')
    expect(days.findAll('.period-column')).toHaveLength(24)
    expect(days.findAll('button.period-column')).toHaveLength(0)
  })
})

describe('the figures of the overview', () => {
  const before = {
    from: momentAt(new Date(2026, 10, 2)),
    to: momentAt(new Date(2026, 10, 9)),
  }
  const mountTiles = (seconds: number, was: number) =>
    mount(SpendingTiles, {
      props: {
        usage: figuresAnswer({ seconds }, { ...before, spent: { seconds: was } }),
        readAt: new Date(2026, 10, 11, 14, 30),
        measure: 'time',
      },
      global: { plugins: [analyticsI18n()] },
    })

  it('say a rise to ten times its base or more from the base, not as a share', () => {
    const steep = words(mountTiles(3000, 120).get('[role="radio"][aria-checked="true"]').text())
    expect(steep).toContain('↑ from 2 min in Nov 2 – 8')
    expect(steep).not.toContain('%')
    const gentle = words(mountTiles(1080, 120).get('[role="radio"][aria-checked="true"]').text())
    expect(gentle).toContain('↑ 800% against Nov 2 – 8')
  })

  it('mark the measure chosen by more than its colour', () => {
    const tiles = mountTiles(3000, 120)
    const chosen = tiles
      .findAll('[role="radio"]')
      .filter((one) => one.find('.tile-chosen').exists())
    expect(chosen).toHaveLength(1)
    expect(chosen[0]?.attributes('aria-checked')).toBe('true')
  })
})
