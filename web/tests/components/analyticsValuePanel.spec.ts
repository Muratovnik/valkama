/**
 * The side panel a value of the Analytics page opens, and the narrowing it offers. The oracle is
 * the requirement: the panel names the value, says its time, tokens, cost and share of the whole,
 * its days and the models and accounts it ran on, and offers its card where it is a task;
 * «Narrow the page to it» narrows the view to the value and breaks it down by task as a new place
 * in the history, and closes the panel; for work with no task, which has no card, it breaks the
 * view down by project crossed with launch class, or by launch class alone at a project's scope,
 * where the page has no section of projects. An opening or a narrowing the address cannot hold
 * says why instead of happening.
 */
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { noTask, serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { stubAnalyticsReads } from '../support/analyticsReads.ts'
import { showView } from '../support/chartViews.ts'
import {
  cardLinks,
  detailOf,
  follow,
  MONDAY,
  mountPage,
  narrowButton,
  panelOf,
  pressEachTest,
  WORLD,
  written,
} from '../support/valuePresses.ts'

vi.mock('@/shared/api/analyticsUses.ts', () => ({ reportAnalyticsUse: vi.fn() }))

pressEachTest()

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
    const named = ['actions', 'figures', 'days', 'model', 'account']
    const parts = panel
      .findAll(named.map((part) => `[data-part="${part}"]`).join(', '))
      .map((one) => one.attributes('data-part'))
    expect(parts).toEqual(named)
    const models = panel.get('[data-part="model"]').findAll('.ranked-label')
    expect(models.map((one) => one.text())).toEqual(['model-01', 'Unknown'])
  })

  it('names work with no task, offers no card and narrows by where the work came from', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item', detail: detailOf('work_item', null) })
    expect(panelOf(host).get('h2').text()).toBe('No task')
    expect(cardLinks(host)).toHaveLength(0)
    expect(narrowButton(host).attributes('aria-description')).toBe(BREAK_DOWN)
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

/** What narrowing to work with no task does, as the panel's action describes it. */
const BREAK_DOWN = 'Break down the work with no task by project and launch class'

describe('work with no task', () => {
  it('breaks the view down by project and launch class from its panel, as a new place', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item', filters: '{"model":["model-01"]}' })
    const bar = host.get('.spending-bars button.ranked-line[aria-label="Details of No task"]')
    expect(bar.get('.ranked-label').text()).toBe('No task')

    await bar.trigger('click')
    await follow(host)
    await narrowButton(host).trigger('click')
    // The filter of no task joins the filters the view had, and the panel closes.
    expect(written(host).at(-1)).toEqual([
      {
        by: 'project',
        across: 'launch_class',
        filters: '{"work_item":[null],"model":["model-01"]}',
      },
      'push',
    ])
    await follow(host)
    // The view's reads carry the filters; the reads its colours are ranked over carry none.
    const filtered = (groupBy: string) =>
      reads.grouped(groupBy).filter((one) => one.has('none') || one.has('model'))
    const read = filtered('project').at(-1)
    expect(read?.get('none')).toBe('work_item')
    expect(read?.get('model')).toBe('model-01')
    expect(filtered('project,launch_class').at(-1)?.get('none')).toBe('work_item')
  })

  it('opens the same panel from its row of the table and from the overview’s card of tasks', async () => {
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

  it('breaks it down by launch class alone at a project’s scope, which has no section of projects', async () => {
    const alpha = value('alpha')
    const world: TimedStretch[] = [
      {
        at: MONDAY,
        group: { work_item: task(1, 'Task 1'), project: alpha },
        spend: { seconds: 3600 },
      },
      { at: MONDAY, group: { work_item: noTask, project: alpha }, spend: { seconds: 1800 } },
    ]
    stubAnalyticsReads((query) => serveUsage(world, query))
    const host = await mountPage(
      { by: 'work_item', across: 'model', detail: detailOf('work_item', null) },
      'en',
      'alpha',
    )
    const narrow = narrowButton(host)
    expect(narrow.attributes('aria-description')).toBe(
      'Break down the work with no task by launch class',
    )
    await narrow.trigger('click')
    // The crossing by model the view had would cross launch classes with models: it is dropped.
    expect(written(host)).toEqual([
      [{ by: 'launch_class', filters: '{"work_item":[null]}' }, 'push'],
    ])
  })

  it('says what it does in Russian, in the bars, in the table and in the panel', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item', detail: detailOf('work_item', null) }, 'ru')
    const words = 'Подробнее: Без задачи'
    expect(
      host.get(`.spending-bars button.ranked-line[aria-label="${words}"] .ranked-label`).text(),
    ).toBe('Без задачи')
    expect(host.get(`.spending-table th button[aria-description="${words}"]`).text()).toBe(
      'Без задачи',
    )
    const narrow = panelOf(host)
      .findAll('button')
      .find((one) => one.text() === 'Сузить страницу до него')
    expect(narrow?.attributes('aria-description')).toBe(
      'Разобрать работу без задачи по проектам и способам запуска',
    )
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

    await narrowButton(host).trigger('click')
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
