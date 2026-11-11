/**
 * From the Analytics page to a task in two presses, through the page. The oracle is the
 * requirement: a bar or a table row of any dimension but the task narrows the view to its value
 * and breaks it down by task, and a day column narrows it to that day alone, each as a new place
 * in the history (`push`) so Back returns; a task's bar is a link the app opens as any reference
 * to the task, and each opening is counted once as `task_open`. Unknown work and the folded tail
 * are not controls, and a narrowing the address cannot hold says why instead of happening.
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
 * Twelve tasks on Monday, each under its own model and each an hour shorter than the one
 * before, so by model ten values stand and two fold into «Other». Work with no task and work no
 * one can place go under the first model, and Tuesday has work of no known model.
 */
const WORLD: TimedStretch[] = [
  ...Array.from({ length: 12 }, (_, index) => ({
    at: MONDAY,
    group: { work_item: task(index + 1, `Task ${index + 1}`), model: value(model(index + 1)) },
    spend: { seconds: (13 - index) * 3600 },
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
  props: { routeState: { type: Object as PropType<Record<string, string>>, default: undefined } },
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
    return () => h(AnalyticsView, { routeState: props.routeState })
  },
})

async function mountPage(routeState: Record<string, string>, locale: 'en' | 'ru' = 'en') {
  const host = mount(Host, {
    props: { routeState },
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
    expect(written(host)).toEqual([[{ filters: '{"model":["model-02"]}' }, 'push']])

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
    expect(written(host)).toEqual([[{ filters: '{"model":["model-03"]}' }, 'push']])
  })

  it('narrows the view to a day pressed in the chart of days, then opens a task of it', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const host = await mountPage({ by: 'model' })
    const days = host.findAll('.spending-days button.period-column')
    expect(days).toHaveLength(3)
    expect(days[1]?.attributes('aria-label')).toMatch(/^Show the tasks of .*10/u)

    await days[1]?.trigger('click')
    expect(written(host)).toEqual([
      [{ period: 'custom', from: '2026-11-10', to: '2026-11-10' }, 'push'],
    ])

    await follow(host)
    const read = reads.grouped('work_item').at(-1)
    expect([read?.get('from'), read?.get('to')]).toEqual(['2026-11-10', '2026-11-11'])
    // Tuesday's one task stands alone, and opens from its bar.
    await openFirstTask(host)
    expect(opened).toEqual(['MAIN-1'])
    expect(taskOpenings()).toBe(1)
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
    expect(written(host)).toEqual([[{ filters: '{"launch_class":[null]}' }, 'push']])
    await follow(host)
    expect(reads.grouped('work_item').at(-1)?.get('none')).toBe('launch_class')
  })
})

describe('what is not a control', () => {
  it('leaves unknown work and the folded tail as lines, by model and by task', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const byModel = await mountPage({ by: 'model' })
    const lines = byModel.findAll('.spending-bars .ranked-line')
    const plain = lines.filter((line) => line.element.tagName === 'DIV')
    expect(plain.map((line) => line.get('.ranked-label').text())).toEqual([
      'Other, 2 more',
      'Unknown',
    ])
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

    const byTask = await mountPage({})
    const taskLines = byTask.findAll('.spending-bars .ranked-line')
    const notLinks = taskLines.filter((line) => line.element.tagName !== 'A')
    expect(notLinks.map((line) => line.element.tagName)).toEqual(['DIV', 'DIV', 'DIV'])
    expect(notLinks.map((line) => line.get('.ranked-label').text())).toEqual([
      'Other, 2 more',
      'No task',
      'Unknown',
    ])
    expect(byTask.findAll('.spending-bars button.ranked-line')).toHaveLength(0)
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
    expect(headingsOf(byModel, '.spending-bars', ['model-02', 'Other, 2 more', 'Unknown'])).toEqual(
      [narrows('model-02'), plain('Other, 2 more'), plain('Unknown')],
    )
    expect(headingsOf(byModel, '.spending-days', ['Tuesday, November 10'])).toEqual([
      narrows('Tuesday, November 10'),
    ])
    byModel.unmount()

    const byTask = await mountPage({})
    await showTable(byTask, '.spending-bars')
    for (const section of ['.spending-table', '.spending-bars'])
      expect(headingsOf(byTask, section, ['MAIN-1 Task 1', 'No task', 'Unknown'])).toEqual([
        links('MAIN-1 Task 1'),
        plain('No task'),
        plain('Unknown'),
      ])
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
    await ru.get(`.spending-table th button`).trigger('click')
    expect(written(ru)).toEqual([])
    expect(ru.get('.spending-table [role="alert"]').text()).toBe(
      `Ссылка на этот вид не вмещает ещё один фильтр, поэтому задачи «${LONG}» не показаны. Снимите фильтр, чтобы освободить место.`,
    )
  })
})
