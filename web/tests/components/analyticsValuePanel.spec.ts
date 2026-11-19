/**
 * The side panel a value of the Analytics page opens, and the adding to the filter it offers. The
 * oracle is the requirement: the panel names the value, says its time, tokens, cost and share of
 * the whole, its days and the models and accounts it ran on, and offers its card where it is a
 * task; «Add to filter» adds the value to its dimension's filter beside the values there, keeps
 * the page on its section and closes the panel, as a new place in the history, and a value the
 * filter holds already offers it disabled, «Already in filter». An opening or an adding the
 * address cannot hold
 * says why instead of happening. What qualifies the figures — the agent time of agents at once
 * added up, the cost an estimate, what the tokens count, a minute's figures shared out where the read is by the minute — the panel says once, in
 * an «ⓘ» of its own named for the figures, never as a line: the section's «ⓘ» stands under it.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { noTask, serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { stubAnalyticsReads } from '../support/analyticsReads.ts'
import { showView } from '../support/chartViews.ts'
import {
  addButton,
  cardLinks,
  detailOf,
  follow,
  MONDAY,
  mountPage,
  panelOf,
  panelShown,
  pressEachTest,
  WORLD,
  written,
} from '../support/valuePresses.ts'

vi.mock('@/shared/api/analyticsUses.ts', () => ({ reportAnalyticsUse: vi.fn() }))

pressEachTest()

/** The caveats of the figures in the words of the catalog, in each language. */
const CAVEAT_WORDS = {
  en: {
    spending: [
      'Agent time adds up agents working at once: two agents for an hour each make 2\u{A0}h.',
      'The cost is an estimate at API list prices, not a bill.',
      'Tokens count input, output and cache writes; cache reads stand apart, and reasoning is part of output.',
    ],
    minutes:
      'Figures per minute are an estimate: each stretch of work is shared out among the minutes it spans by its time in each.',
  },
  ru: {
    spending: [
      'Время агентов, работающих одновременно, складывается: два агента по часу — 2\u{A0}ч.',
      'Стоимость — оценка по прейскуранту API, а не счёт.',
      'Токены — это вход, выход и запись в кэш; чтение кэша стоит отдельно, а рассуждения входят в выход.',
    ],
    minutes:
      'Цифры по минутам — оценка: каждый отрезок работы делится между минутами, которые он захватывает, по времени в каждой.',
  },
}
const EVERY_CAVEAT = Object.values(CAVEAT_WORDS).flatMap((one) => [...one.spending, one.minutes])

/**
 * The panel's «ⓘ» named `name`, the one in it and in its figures: the caveats it says once
 * pressed, in order of their words, and every caveat the panel shows as a line before that.
 */
async function caveatsOf(host: VueWrapper, name: string) {
  const panel = panelOf(host)
  const press = `button[aria-label="${name}"]`
  expect(panel.findAll(press)).toHaveLength(1)
  expect(panel.get('[data-part="figures"]').findAll(press)).toHaveLength(1)
  const text = panel.text().replaceAll(/\s+/gu, ' ')
  const asLines = EVERY_CAVEAT.filter((caveat) => text.includes(caveat))
  expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(0)
  await panel.get(press).trigger('click')
  await flushPromises()
  const tips = document.querySelectorAll('[role="tooltip"]')
  expect(tips).toHaveLength(1)
  const inTip = [...(tips[0]?.querySelectorAll('p') ?? [])]
    .map((line) => (line.textContent ?? '').trim())
    .sort()
  return { inTip, asLines }
}

describe('what a value’s panel shows', () => {
  it('says a task’s figures, its share of the whole and the models and accounts it ran on', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item', detail: detailOf('work_item', task(1, '').id) })
    const panel = panelOf(host)
    const figures = Object.fromEntries(
      panel
        .findAll('[data-figure]')
        .map((one) => [
          one.attributes('data-figure'),
          one.get('dd').text().replaceAll(/\s/gu, ' '),
        ]),
    )
    // Task 1 spent eleven hours on Monday and one on Tuesday, of the week's 67 hours and 40 minutes
    // the ten tasks, no task and unknown work spent: 12 / 67.67 is 17.7 %, said as 18 %.
    expect(Object.keys(figures)).toEqual(['time', 'tokens', 'cost', 'share'])
    expect(figures.time).toBe('12 h')
    expect(figures.share).toBe('18% · Agent time')
    // The panel's parts, in the order they stand; a chart's legend names its own parts inside.
    const named = ['actions', 'figures', 'days', 'model', 'seat']
    const parts = panel
      .findAll(named.map((part) => `[data-part="${part}"]`).join(', '))
      .map((one) => one.attributes('data-part'))
    expect(parts).toEqual(named)
    const models = panel.get('[data-part="model"]').findAll('.ranked-label')
    expect(models.map((one) => one.text())).toEqual(['model-01', 'Unknown'])
  })

  it('says what qualifies its figures once, in the «ⓘ» ending their heading, and never as a line', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item', detail: detailOf('work_item', task(1, '').id) })
    const seen = await caveatsOf(host, 'About these figures')
    // A week read by the day: the cost and the tokens are qualified, no minute is shared out.
    expect(seen.inTip).toEqual([...CAVEAT_WORDS.en.spending].sort())
    expect(seen.asLines).toEqual([])
  })

  it('adds that a minute’s figures are shared out where the value is read by the minute, in Russian', async () => {
    // Twenty minutes of «Now», the hour up to Wednesday 14:30, on the first task.
    const live: TimedStretch[] = [
      {
        at: new Date(2026, 10, 11, 14, 5),
        group: { work_item: task(1, 'Task 1') },
        spend: { seconds: 1200 },
      },
    ]
    stubAnalyticsReads((query) => serveUsage(live, query))
    const host = await mountPage(
      { period: 'now', by: 'work_item', detail: detailOf('work_item', task(1, '').id) },
      'ru',
    )
    const seen = await caveatsOf(host, 'Об этих цифрах')
    expect(seen.inTip).toEqual([...CAVEAT_WORDS.ru.spending, CAVEAT_WORDS.ru.minutes].sort())
    expect(seen.asLines).toEqual([])
  })

  it('says a value with nothing in the period spent nothing', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'model', detail: detailOf('model', 'model-99') })
    expect(panelOf(host).get('[data-detail="value"]').text()).toBe(
      'Nothing was spent on it in this period.',
    )
    expect(panelOf(host).find('[data-part="figures"]').exists()).toBe(false)
  })
})

describe('adding the value to the page’s filter', () => {
  it('adds work with no task beside the filters the view had, keeps the section and closes the panel, as a new place', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item', filters: '{"model":["model-01"]}' })
    const bar = host.get('.spending-bars button.ranked-line[aria-label="Details of No task"]')
    expect(bar.get('.ranked-label').text()).toBe('No task')

    await bar.trigger('click')
    await follow(host)
    await addButton(host).trigger('click')
    // The filter of no task joins the filters the view had, the section stays and the panel closes.
    expect(written(host).at(-1)).toEqual([
      { by: 'work_item', filters: '{"work_item":[null],"model":["model-01"]}' },
      'push',
    ])
    await follow(host)
    expect(panelShown(host)).toBe(false)
    // The view's reads carry both filters.
    const read = reads.grouped('work_item').findLast((one) => one.has('none') && one.has('model'))
    expect(read?.get('none')).toBe('work_item')
    expect(read?.get('model')).toBe('model-01')
  })

  it('adds a value beside the values its dimension’s filter holds', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({
      by: 'model',
      filters: '{"model":["model-01","model-02"]}',
      detail: detailOf('model', 'model-03'),
    })
    await addButton(host).trigger('click')
    expect(written(host)).toEqual([
      [{ by: 'model', filters: '{"model":["model-01","model-02","model-03"]}' }, 'push'],
    ])
  })

  it('offers nothing to add for a value the filter holds already, in each language', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const state = {
      by: 'model',
      filters: '{"model":["model-01"]}',
      detail: detailOf('model', 'model-01'),
    }
    const host = await mountPage(state)
    const held = addButton(host, 'Already in filter')
    expect(held.attributes('disabled')).toBeDefined()
    await held.trigger('click')
    expect(written(host)).toEqual([])
    host.unmount()

    const ru = await mountPage(state, 'ru')
    expect(addButton(ru, 'Уже в фильтре').attributes('disabled')).toBeDefined()
    ru.unmount()
    // Its control: a value the filter does not hold offers the adding, in Russian too.
    const other = await mountPage({ ...state, detail: detailOf('model', 'model-02') }, 'ru')
    expect(addButton(other, 'Добавить в фильтр').attributes('disabled')).toBeUndefined()
  })

  it('names work with no task, offers no card and offers to add it, in Russian', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item', detail: detailOf('work_item', null) }, 'ru')
    const words = 'Подробнее: Без задачи'
    expect(
      host.get(`.spending-bars button.ranked-line[aria-label="${words}"] .ranked-label`).text(),
    ).toBe('Без задачи')
    expect(host.get(`.spending-table th button[aria-description="${words}"]`).text()).toBe(
      'Без задачи',
    )
    expect(panelOf(host).get('h2').text()).toBe('Без задачи')
    expect(cardLinks(host)).toHaveLength(0)
    expect(addButton(host, 'Добавить в фильтр').attributes('disabled')).toBeUndefined()
  })

  it('opens the panel of work with no task from its row of the table and from the overview’s card of tasks', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const section = await mountPage({ by: 'work_item' })
    const row = section.get('.spending-table th button[aria-description="Details of No task"]')
    expect(row.text()).toBe('No task')
    await row.trigger('click')
    expect(written(section)).toEqual([
      [{ by: 'work_item', detail: detailOf('work_item', null) }, 'push'],
    ])
    section.unmount()

    // On the overview the card of tasks names the first five, so here work with no task leads.
    stubAnalyticsReads((query) =>
      serveUsage(
        [
          {
            at: MONDAY,
            group: { work_item: noTask, model: value('model-01') },
            spend: { seconds: 60 },
          },
        ],
        query,
      ),
    )
    const overview = await mountPage({})
    const card = overview.get('[data-card="work_item"]')
    await card.get('button.ranked-line[aria-label="Details of No task"]').trigger('click')
    expect(written(overview)).toEqual([[{ detail: detailOf('work_item', null) }, 'push']])
  })

  it('is refused in the panel with the reason where its filter would not fit the address', async () => {
    const models = [1, 2, 3, 4].map((one) => `${'a-model-with-a-long-name-'.repeat(2)}${one}`)
    const filters = JSON.stringify({ model: models })
    // The precondition: the view's filters fit the 240 characters a state holds, and with the
    // filter of no task they do not.
    expect(filters.length).toBeLessThanOrEqual(240)
    expect(JSON.stringify({ work_item: [null], model: models }).length).toBeGreaterThan(240)
    const world: TimedStretch[] = models.map((one) => ({
      at: MONDAY,
      group: { work_item: noTask, model: value(one) },
      spend: { seconds: 3600 },
    }))
    stubAnalyticsReads((query) => serveUsage(world, query))
    const host = await mountPage({ by: 'work_item', filters, detail: detailOf('work_item', null) })

    await addButton(host).trigger('click')
    await flushPromises()
    expect(written(host)).toEqual([])
    expect(panelOf(host).get('[role="alert"]').text()).toBe(
      'The link to this view cannot hold one more filter, so the tasks of No task are not shown. Clear a filter to make room.',
    )
  })
})

describe('an opening the address cannot hold', () => {
  /** A model id too long for the address to hold its panel beside its dimension's name. */
  const LONG = `model-${'x'.repeat(220)}`
  const world: TimedStretch[] = [
    {
      at: MONDAY,
      group: { work_item: task(1, 'Task 1'), model: value(LONG) },
      spend: { seconds: 3600 },
    },
  ]

  it('says why in the part it was pressed in, and keeps the view and its reads', async () => {
    // The precondition: the panel's address is longer than the 240 characters a state holds.
    expect(detailOf('model', LONG).length).toBeGreaterThan(240)
    const reads = stubAnalyticsReads((query) => serveUsage(world, query))
    const host = await mountPage({ by: 'model' })
    await showView(host, '.spending-bars', 'Bars')
    const asked = reads.asked.length

    await host.get(`.spending-bars [aria-label="Details of ${LONG}"]`).trigger('click')
    await flushPromises()
    expect(written(host)).toEqual([])
    expect(reads.asked).toHaveLength(asked)
    expect(host.get('.spending-bars [role="alert"]').text()).toBe(
      `The link to this view cannot hold the details of ${LONG}, so they are not opened.`,
    )
    expect(host.findAll('[role="alert"]')).toHaveLength(1)

    // The same press in the table says it there, in Russian.
    host.unmount()
    const ru = await mountPage({ by: 'model' }, 'ru')
    await ru.get(`.spending-table tbody th button`).trigger('click')
    expect(written(ru)).toEqual([])
    expect(ru.get('.spending-table [role="alert"]').text()).toBe(
      `Ссылка на этот вид не вмещает подробности «${LONG}», поэтому они не открыты.`,
    )
  })
})
