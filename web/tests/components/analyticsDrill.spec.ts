/**
 * What a press on a value of the Analytics page does. The oracle is the requirement: an ordinary
 * press on a bar, a segment or a table row of any dimension opens that value's side panel as a new
 * place in the history (`push`), the view itself unchanged; a press with a modifier on a task's
 * link is the browser's, counted once as `task_open`, and the panel's «Open the card» opens the
 * card in place, counted once too. A day column still narrows the view to that day alone. Unknown
 * work is not a control, and a deleted task opens a panel with no card. What the panel shows, and
 * what adding its value to the filter from it does, is `analyticsValuePanel.spec.ts`.
 */
import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { serveUsage, task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { stubAnalyticsReads } from '../support/analyticsReads.ts'
import { showView } from '../support/chartViews.ts'
import { rowHeadings } from '../support/rowHeadings.ts'
import {
  addButton,
  cardLinks,
  detailOf,
  follow,
  MONDAY,
  mountPage,
  opened,
  openFirstTask,
  panelOf,
  panelShown,
  pressEachTest,
  taskOpenings,
  WORLD,
  written,
} from '../support/valuePresses.ts'

vi.mock('@/shared/api/analyticsUses.ts', () => ({ reportAnalyticsUse: vi.fn() }))

pressEachTest()

describe('a value pressed on the Analytics page', () => {
  it('opens a model’s panel from its bar, and adds the model to the filter from the panel', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'model' })

    await host.get('.spending-bars [aria-label="Details of model-02"]').trigger('click')
    // The view stays as it was; the panel is a new place over it.
    expect(written(host)).toEqual([
      [{ by: 'model', detail: detailOf('model', 'model-02') }, 'push'],
    ])
    await follow(host)
    expect(panelOf(host).get('h2').text()).toBe('model-02')
    // A model has no card: the panel offers none, and reads by account alone.
    expect(cardLinks(host)).toHaveLength(0)
    const byAccount = reads.grouped('model,seat').at(-1)
    expect(byAccount?.get('model')).toBe('model-02')
    expect(reads.grouped('model,model')).toHaveLength(0)

    // The section stays the models', now filtered to model-02 alone.
    await addButton(host).trigger('click')
    expect(written(host).at(-1)).toEqual([
      { by: 'model', filters: '{"model":["model-02"]}' },
      'push',
    ])
    await follow(host)
    expect(panelShown(host)).toBe(false)
    // The view's read carries the filter; the reads its colours are ranked over carry none.
    const read = reads.grouped('model').findLast((one) => one.has('model'))
    expect(read?.get('model')).toBe('model-02')
    expect(read?.get('none')).toBeNull()
  })

  it('opens a task’s panel with a plain press, and its card from the panel, counted once', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item' })
    await openFirstTask(host)
    expect(opened).toEqual([])
    expect(taskOpenings()).toBe(0)
    expect(written(host)).toEqual([
      [{ by: 'work_item', detail: detailOf('work_item', task(1, '').id) }, 'push'],
    ])
    await follow(host)
    expect(panelOf(host).get('h2').text()).toBe('MAIN-1 Task 1')
    const [card] = cardLinks(host)
    expect(card?.attributes('href')).toBe('/open/MAIN-1')
    await card?.trigger('click', { button: 0 })
    expect(opened).toEqual(['MAIN-1'])
    expect(taskOpenings()).toBe(1)
  })

  it('leaves a press with a modifier on a task to the browser, counted once, and opens no panel', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item' })
    const link = host.get('.spending-bars a.ranked-line[href="/open/MAIN-1"]')
    const press = new MouseEvent('click', {
      button: 0,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    link.element.dispatchEvent(press)
    await flushPromises()
    // Not prevented: the browser takes it to a new tab.
    expect(press.defaultPrevented).toBe(false)
    expect(written(host)).toEqual([])
    expect(opened).toEqual([])
    expect(taskOpenings()).toBe(1)
    // The plain press beside it is the page's, the control.
    await openFirstTask(host)
    expect(written(host)).toHaveLength(1)
    expect(taskOpenings()).toBe(1)
  })

  it('opens a model’s panel from its row of the table beside the period before', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'model' })
    const row = host.get('.spending-table th button[aria-description="Details of model-03"]')
    expect(row.text()).toBe('model-03')
    await row.trigger('click')
    expect(written(host)).toEqual([
      [{ by: 'model', detail: detailOf('model', 'model-03') }, 'push'],
    ])
  })

  it('narrows the view to a day pressed in the chart of days, then opens a task’s panel there', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'model' })
    const days = host.findAll('.spending-days button.period-column')
    expect(days).toHaveLength(3)
    expect(days[1]?.attributes('aria-label')).toBe('Show the tasks of Tuesday, November 10')

    await days[1]?.trigger('click')
    expect(written(host)).toEqual([
      [{ period: 'custom', from: '2026-11-10', to: '2026-11-10', by: 'work_item' }, 'push'],
    ])

    await follow(host)
    const read = reads.grouped('work_item').at(-1)
    expect([read?.get('from'), read?.get('to')]).toEqual(['2026-11-10', '2026-11-11'])
    // Tuesday's one task stands alone, and opens its panel from its bar.
    await openFirstTask(host)
    expect(written(host).at(-1)?.[0].detail).toBe(detailOf('work_item', task(1, '').id))
  })

  it('names a day of the chart in Russian by its date, so «за» takes no weekday', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'model' }, 'ru')
    const days = host.findAll('.spending-days button.period-column')
    // Named by its weekday, a day would read «Показать задачи за среда».
    expect(days.map((day) => day.attributes('aria-label'))).toEqual([
      'Показать задачи за 9 ноября, пн',
      'Показать задачи за 10 ноября, вт',
      'Показать задачи за 11 ноября, ср',
    ])
  })

  it('opens a segment’s value’s panel, and leaves one of unknown work going nowhere', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'model' })
    const [monday, tuesday] = host.findAll('.spending-days .period-slot')
    // Tuesday's one stretch ran under no known model: its segment shows a hint and is no control.
    const unknown = tuesday?.get('.period-segment')
    expect(unknown?.element.tagName).toBe('SPAN')
    const segment = monday?.get('.period-segment[data-series="v:model-02"]')
    expect(segment?.element.tagName).toBe('BUTTON')
    // A person presses a moment after the chart is drawn; Vue drops a press stamped no later
    // than its handler was attached.
    vi.setSystemTime(Date.now() + 1000)
    await unknown?.trigger('click')
    expect(written(host)).toEqual([])
    await segment?.trigger('click')
    expect(written(host)).toEqual([
      [{ by: 'model', detail: detailOf('model', 'model-02') }, 'push'],
    ])
  })

  it('opens the panel of a session’s own run, which the read admits by none', async () => {
    const world: TimedStretch[] = [
      {
        at: MONDAY,
        group: { work_item: task(1, 'Task 1'), launch_class: { id: null, unknown: false } },
        spend: { seconds: 3600 },
      },
    ]
    const reads = stubAnalyticsReads((query) => serveUsage(world, query))
    const host = await mountPage({ by: 'launch_class' })
    await showView(host, '.spending-bars', 'Bars')
    const own = host.findAll('.spending-bars button.ranked-line')
    expect(own).toHaveLength(1)
    await own[0]?.trigger('click')
    expect(written(host)).toEqual([
      [{ by: 'launch_class', detail: detailOf('launch_class', null) }, 'push'],
    ])
    await follow(host)
    expect(reads.grouped('launch_class,model').at(-1)?.get('none')).toBe('launch_class')
    await addButton(host).trigger('click')
    expect(written(host).at(-1)).toEqual([
      { by: 'launch_class', filters: '{"launch_class":[null]}' },
      'push',
    ])
  })
})

describe('what is not a control', () => {
  it('leaves unknown work as a line by model and by task, and a deleted task without a card', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const byModel = await mountPage({ by: 'model' })
    await showView(byModel, '.spending-bars', 'Bars')
    const lines = byModel.findAll('.spending-bars .ranked-line')
    const plain = lines.filter((line) => line.element.tagName === 'DIV')
    expect(plain.map((line) => line.get('.ranked-label').text())).toEqual(['Unknown'])
    for (const line of plain) {
      expect(line.attributes('tabindex')).toBeUndefined()
      expect(line.attributes('role')).toBeUndefined()
    }
    expect(lines.filter((line) => line.element.tagName === 'BUTTON')).toHaveLength(10)
    const tableUnknown = byModel
      .findAll('.spending-table tbody th')
      .find((cell) => cell.text() === 'Unknown')
    expect(tableUnknown?.find('button, a').exists()).toBe(false)
    byModel.unmount()

    const byTask = await mountPage({ by: 'work_item' })
    const taskLines = byTask.findAll('.spending-bars .ranked-line')
    const notLinks = taskLines.filter((line) => line.element.tagName !== 'A')
    // Work with no task is the one control by task that is not a link (`work with no task`).
    expect(notLinks.map((line) => line.element.tagName)).toEqual(['BUTTON', 'DIV'])
    expect(notLinks.map((line) => line.get('.ranked-label').text())).toEqual(['No task', 'Unknown'])
    byTask.unmount()

    // A task deleted since still has its figures: its panel opens, with no card to open.
    const deleted = { ...task(11, ''), reference: null, title: null }
    stubAnalyticsReads((query) =>
      serveUsage([{ at: MONDAY, group: { work_item: deleted }, spend: { seconds: 300 } }], query),
    )
    const gone = await mountPage({ by: 'work_item' })
    const line = gone.get('.spending-bars .ranked-line')
    expect([line.element.tagName, line.get('.ranked-label').text()]).toEqual([
      'BUTTON',
      'Deleted task',
    ])
    await line.trigger('click')
    await follow(gone)
    expect(panelOf(gone).get('h2').text()).toBe('Deleted task')
    expect(cardLinks(gone)).toHaveLength(0)
  })
})

/** Shows a chart of the page as its table, by its own control. */
const showTable = (host: VueWrapper, section: string) => showView(host, section, 'Table')

/** The row headings of a table whose names are the given ones, in that order. */
const headingsOf = (host: VueWrapper, section: string, names: string[]) =>
  names.map((name) => rowHeadings(host.get(section)).find((heading) => heading.name === name))

/** A row heading that opens its value's panel, one that narrows to a day, and one that does neither. */
const inspects = (name: string, role: 'button' | 'link' = 'button') => ({
  name,
  control: { role, name, description: `Details of ${name}` },
})
const narrows = (name: string) => ({
  name,
  control: { role: 'button', name, description: `Show the tasks of ${name}` },
})
const plain = (name: string) => ({ name, control: null })

describe('the row headings of the page’s tables', () => {
  it('are named by their value, and say what pressing one does as its description', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const byModel = await mountPage({ by: 'model' })
    await showTable(byModel, '.spending-bars')
    await showTable(byModel, '.spending-days')
    expect(headingsOf(byModel, '.spending-table', ['model-02', 'Unknown'])).toEqual([
      inspects('model-02'),
      plain('Unknown'),
    ])
    expect(headingsOf(byModel, '.spending-bars', ['model-02', 'Unknown'])).toEqual([
      inspects('model-02'),
      plain('Unknown'),
    ])
    expect(headingsOf(byModel, '.spending-days', ['Tuesday, November 10'])).toEqual([
      narrows('Tuesday, November 10'),
    ])
    byModel.unmount()

    const byTask = await mountPage({ by: 'work_item' })
    await showTable(byTask, '.spending-bars')
    for (const section of ['.spending-table', '.spending-bars'])
      expect(headingsOf(byTask, section, ['MAIN-1 Task 1', 'No task', 'Unknown'])).toEqual([
        inspects('MAIN-1 Task 1', 'link'),
        inspects('No task'),
        plain('Unknown'),
      ])
  })
})
