/**
 * From the Analytics page to a task in two presses, through the page. The oracle is the
 * requirement: a bar or a table row of any dimension but the task narrows the view to its value
 * and breaks it down by task, and a day column narrows it to that day alone, each as a new place
 * in the history (`push`) so Back returns; a task's bar is a link the app opens as any reference
 * to the task, and each opening is counted once as `task_open`. Work with no task, which has no
 * card, narrows the view to itself and breaks it down by project crossed with launch class, or by
 * launch class alone at a project's scope, where the page has no section of projects. Unknown
 * work, a deleted task and the folded tail are not controls, and a narrowing the address cannot
 * hold says why instead of happening.
 */
import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AnalyticsView from '@/pages/analytics/AnalyticsView.vue'

import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'

import { noTask, serveUsage, task, unknownTask, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { analyticsI18n, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { rowHeadings } from '../support/rowHeadings.ts'

vi.mock('@/shared/api/analyticsUses.ts', () => ({ reportAnalyticsUse: vi.fn() }))

/** Wednesday afternoon; the week read by default runs from Monday the 9th to now. */
const NOW = new Date(2026, 10, 11, 14, 30)
const MONDAY = new Date(2026, 10, 9, 10)

const model = (number: number) => `model-${String(number).padStart(2, '0')}`

/**
 * Ten tasks on Monday, each under its own model and each an hour shorter than the one before,
 * so a ranked list names every value by task and by model. Work with no task and work no one can
 * place go under the first model, and Tuesday has work of no known model.
 */
const WORLD: TimedStretch[] = [
  ...Array.from({ length: 10 }, (_, index) => ({
    at: MONDAY,
    group: { work_item: task(index + 1, `Task ${index + 1}`), model: value(model(index + 1)) },
    spend: { seconds: (11 - index) * 3600 },
  })),
  { at: MONDAY, group: { work_item: noTask, model: value(model(1)) }, spend: { seconds: 1800 } },
  {
    at: MONDAY,
    group: { work_item: unknownTask, model: value(model(1)) },
    spend: { seconds: 600 },
  },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(1, 'Task 1'), model: { id: null, unknown: true } },
    spend: { seconds: 3600 },
  },
]

/** What the app does with a task's reference: its short address, and opening it in place. */
const opened: string[] = []

/** The page inside a layer that resolves task references, as the app shell provides one. */
const Host = defineComponent({
  props: {
    routeState: { type: Object as PropType<Record<string, string>>, default: undefined },
    projectId: { type: String, default: undefined },
  },
  setup(props) {
    provideReferenceLinks((reference, parent) =>
      reference.kind === 'work-item'
        ? {
            title: reference.value,
            href: `/open/${reference.value}`,
            open: () => opened.push(reference.value),
          }
        : parent(reference),
    )
    return () => h(AnalyticsView, { routeState: props.routeState, projectId: props.projectId })
  },
})

async function mountPage(
  routeState: Record<string, string>,
  locale: 'en' | 'ru' = 'en',
  projectId?: string,
) {
  const host = mount(Host, {
    props: { routeState, projectId },
    attachTo: document.body,
    global: { plugins: [analyticsI18n(locale)] },
  })
  await flushPromises()
  return host
}

type Written = [Record<string, string>, ('push' | 'replace')?]
const written = (host: VueWrapper) =>
  host.getComponent(AnalyticsView).emitted<Written>('state') ?? []

/** Goes where the page asked to go, as the shell does with a new address. */
async function follow(host: VueWrapper) {
  await host.setProps({ routeState: written(host).at(-1)?.[0] })
  await flushPromises()
}

const taskOpenings = () =>
  vi.mocked(reportAnalyticsUse).mock.calls.filter(([kind]) => kind === 'task_open').length

/** Presses the first task's bar, as a plain click the page answers in place. */
async function openFirstTask(host: VueWrapper) {
  const link = host.get('.spending-bars a.ranked-line[href="/open/MAIN-1"]')
  expect(link.attributes('aria-label')).toBe('MAIN-1 Task 1')
  await link.trigger('click', { button: 0 })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  opened.length = 0
  vi.mocked(reportAnalyticsUse).mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('a value pressed on the Analytics page', () => {
  it('narrows the view to a model and opens a task of it from its bar, counted once', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'model' })

    await host.get('.spending-bars [aria-label="Show the tasks of model-02"]').trigger('click')
    expect(written(host)).toEqual([
      [{ by: 'work_item', filters: '{"model":["model-02"]}' }, 'push'],
    ])

    await follow(host)
    const read = reads.grouped('work_item').at(-1)
    expect(read?.get('model')).toBe('model-02')
    expect(read?.get('none')).toBeNull()
    // Only the second task worked under model-02: its bar is the one link of the chart.
    const links = host.findAll('.spending-bars a.ranked-line')
    expect(links.map((link) => link.attributes('href'))).toEqual(['/open/MAIN-2'])
    expect(links[0]?.attributes('aria-label')).toBe('MAIN-2 Task 2')

    expect(taskOpenings()).toBe(0)
    await links[0]?.trigger('click', { button: 0 })
    expect(opened).toEqual(['MAIN-2'])
    expect(taskOpenings()).toBe(1)
  })

  it('narrows the view to a model from its row of the table beside the period before', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'model' })
    const row = host.get('.spending-table th button[aria-description="Show the tasks of model-03"]')
    expect(row.text()).toBe('model-03')
    await row.trigger('click')
    expect(written(host)).toEqual([
      [{ by: 'work_item', filters: '{"model":["model-03"]}' }, 'push'],
    ])
  })

  it('narrows the view to a day pressed in the chart of days, then opens a task of it', async () => {
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
    // Tuesday's one task stands alone, and opens from its bar.
    await openFirstTask(host)
    expect(opened).toEqual(['MAIN-1'])
    expect(taskOpenings()).toBe(1)
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

  it('narrows the view to a segment’s value, and leaves one of unknown work going nowhere', async () => {
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
      [{ by: 'work_item', filters: '{"model":["model-02"]}' }, 'push'],
    ])
  })

  it('narrows a breakdown by session kind to a session’s own run, which the read admits by none', async () => {
    const world: TimedStretch[] = [
      {
        at: MONDAY,
        group: { work_item: task(1, 'Task 1'), launch_class: { id: null, unknown: false } },
        spend: { seconds: 3600 },
      },
    ]
    const reads = stubAnalyticsReads((query) => serveUsage(world, query))
    const host = await mountPage({ by: 'launch_class' })
    const own = host.findAll('.spending-bars button.ranked-line')
    expect(own).toHaveLength(1)
    await own[0]?.trigger('click')
    expect(written(host)).toEqual([
      [{ by: 'work_item', filters: '{"launch_class":[null]}' }, 'push'],
    ])
    await follow(host)
    expect(reads.grouped('work_item').at(-1)?.get('none')).toBe('launch_class')
  })
})

describe('what is not a control', () => {
  it('leaves unknown work as a line by model and by task, and a deleted task by task', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const byModel = await mountPage({ by: 'model' })
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

    const deleted = { ...task(11, ''), reference: null, title: null }
    stubAnalyticsReads((query) =>
      serveUsage([{ at: MONDAY, group: { work_item: deleted }, spend: { seconds: 300 } }], query),
    )
    const gone = await mountPage({ by: 'work_item' })
    const line = gone.get('.spending-bars .ranked-line')
    expect([line.element.tagName, line.get('.ranked-label').text()]).toEqual([
      'DIV',
      'Deleted task',
    ])
    expect(line.attributes('tabindex')).toBeUndefined()
  })
})

/** Shows a chart of the page as its table, by its own control. */
async function showTable(host: VueWrapper, section: string) {
  const option = host.findAll(`${section} .segmented-option`).find((one) => one.text() === 'Table')
  await option?.trigger('click')
}

/** The row headings of a table whose names are the given ones, in that order. */
const headingsOf = (host: VueWrapper, section: string, names: string[]) =>
  names.map((name) => rowHeadings(host.get(section)).find((heading) => heading.name === name))

/** A row heading that narrows the view, one that links to a task, and one that does neither. */
const narrows = (name: string) => ({
  name,
  control: { role: 'button', name, description: `Show the tasks of ${name}` },
})
const links = (name: string) => ({ name, control: { role: 'link', name, description: '' } })
const plain = (name: string) => ({ name, control: null })

describe('the row headings of the page’s tables', () => {
  it('are named by their value, and say what pressing one does as its description', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const byModel = await mountPage({ by: 'model' })
    await showTable(byModel, '.spending-bars')
    await showTable(byModel, '.spending-days')
    expect(headingsOf(byModel, '.spending-table', ['model-02', 'Unknown'])).toEqual([
      narrows('model-02'),
      plain('Unknown'),
    ])
    expect(headingsOf(byModel, '.spending-bars', ['model-02', 'Unknown'])).toEqual([
      narrows('model-02'),
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
        links('MAIN-1 Task 1'),
        {
          name: 'No task',
          control: { role: 'button', name: 'No task', description: BREAK_DOWN },
        },
        plain('Unknown'),
      ])
  })
})

/** What pressing work with no task does, as its control says it. */
const BREAK_DOWN = 'Break down the work with no task by project and launch class'

describe('work with no task', () => {
  it('breaks the view down by project and launch class from its bar, as a new place', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item', filters: '{"model":["model-01"]}' })
    const bar = host.get(`.spending-bars button.ranked-line[aria-label="${BREAK_DOWN}"]`)
    expect(bar.get('.ranked-label').text()).toBe('No task')

    await bar.trigger('click')
    // The filter of no task joins the filters the view had.
    expect(written(host)).toEqual([
      [
        {
          by: 'project',
          across: 'launch_class',
          filters: '{"work_item":[null],"model":["model-01"]}',
        },
        'push',
      ],
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

  it('does the same from its row of the table and from the overview’s card of tasks', async () => {
    const expected = [
      [{ by: 'project', across: 'launch_class', filters: '{"work_item":[null]}' }, 'push'],
    ]
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const section = await mountPage({ by: 'work_item' })
    const row = section.get(`.spending-table th button[aria-description="${BREAK_DOWN}"]`)
    expect(row.text()).toBe('No task')
    await row.trigger('click')
    expect(written(section)).toEqual(expected)
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
    await card.get(`button.ranked-line[aria-label="${BREAK_DOWN}"]`).trigger('click')
    expect(written(overview)).toEqual(expected)
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
    const host = await mountPage({ by: 'work_item', across: 'model' }, 'en', 'alpha')
    const bar = host.get('.spending-bars button.ranked-line')
    expect(bar.attributes('aria-label')).toBe('Break down the work with no task by launch class')
    await bar.trigger('click')
    // The crossing by model the view had would cross launch classes with models: it is dropped.
    expect(written(host)).toEqual([
      [{ by: 'launch_class', filters: '{"work_item":[null]}' }, 'push'],
    ])
  })

  it('says what it does in Russian, in the bars and in the table', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'work_item' }, 'ru')
    const words = 'Разобрать работу без задачи по проектам и способам запуска'
    expect(
      host.get(`.spending-bars button.ranked-line[aria-label="${words}"] .ranked-label`).text(),
    ).toBe('Без задачи')
    expect(host.get(`.spending-table th button[aria-description="${words}"]`).text()).toBe(
      'Без задачи',
    )
  })

  it('is refused with the reason where its filter would not fit the address', async () => {
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
    const reads = stubAnalyticsReads((query) => serveUsage(world, query))
    const host = await mountPage({ by: 'work_item', filters })
    const asked = reads.asked.length

    await host.get(`.spending-bars button.ranked-line[aria-label="${BREAK_DOWN}"]`).trigger('click')
    await flushPromises()
    expect(written(host)).toEqual([])
    expect(reads.asked).toHaveLength(asked)
    expect(host.get('.spending-bars [role="alert"]').text()).toBe(
      'The link to this view cannot hold one more filter, so the tasks of No task are not shown. Clear a filter to make room.',
    )
  })
})

describe('a narrowing the address cannot hold', () => {
  /** Five tasks fill the filter of tasks; a long model id would not fit beside them. */
  const LONG = 'a-model-with-a-name-long-enough-to-overflow'
  const tasks = Array.from({ length: 5 }, (_, index) => task(index + 1, `Task ${index + 1}`))
  const ids = tasks.map((one) => one.id ?? '')
  const world: TimedStretch[] = tasks.map((one) => ({
    at: MONDAY,
    group: { work_item: one, model: value(LONG) },
    spend: { seconds: 3600 },
  }))
  const filters = JSON.stringify({ work_item: ids })

  it('says why in the part it was pressed in, and keeps the view and its reads', async () => {
    // The precondition: the narrowed filter is longer than the 240 characters a state holds.
    expect(JSON.stringify({ model: [LONG], work_item: ids }).length).toBeGreaterThan(240)
    const reads = stubAnalyticsReads((query) => serveUsage(world, query))
    const host = await mountPage({ by: 'model', filters })
    const asked = reads.asked.length

    await host.get(`.spending-bars [aria-label="Show the tasks of ${LONG}"]`).trigger('click')
    await flushPromises()
    expect(written(host)).toEqual([])
    expect(reads.asked).toHaveLength(asked)
    expect(host.get('.spending-bars [role="alert"]').text()).toBe(
      `The link to this view cannot hold one more filter, so the tasks of ${LONG} are not shown. Clear a filter to make room.`,
    )
    expect(host.findAll('[role="alert"]')).toHaveLength(1)

    // The same press in the table says it there, in Russian.
    host.unmount()
    const ru = await mountPage({ by: 'model', filters }, 'ru')
    await ru.get(`.spending-table tbody th button`).trigger('click')
    expect(written(ru)).toEqual([])
    expect(ru.get('.spending-table [role="alert"]').text()).toBe(
      `Ссылка на этот вид не вмещает ещё один фильтр, поэтому задачи «${LONG}» не показаны. Снимите фильтр, чтобы освободить место.`,
    )
  })
})
