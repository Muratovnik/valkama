/**
 * The Analytics page as a person presses its values, for the specs of what a press does
 * (`analyticsDrill.spec.ts`) and of the side panel it opens (`analyticsValuePanel.spec.ts`): a
 * week of work that names a value of every kind, the page inside a layer that resolves task
 * references as the app shell provides one, what the page asked to write, and the panel's parts
 * by what they say. A spec that uses it mocks `analyticsUses.ts`, through which a task's openings
 * are counted, and calls `pressEachTest` once.
 */
import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, vi } from 'vitest'

import AnalyticsView from '@/pages/analytics/AnalyticsView.vue'
import ValueDetail from '@/pages/analytics/components/ValueDetail.vue'

import { provideUsageReach } from '@/widgets/work-item-inspector/utils/useWorkItemUsage.ts'

import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'

import { noTask, task, unknownTask, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { analyticsI18n } from './analyticsReads.ts'

/** Wednesday afternoon; the week read by default runs from Monday the 9th to now. */
const NOW = new Date(2026, 10, 11, 14, 30)
export const MONDAY = new Date(2026, 10, 9, 10)

const model = (number: number) => `model-${String(number).padStart(2, '0')}`

/**
 * Ten tasks on Monday, each under its own model and each an hour shorter than the one before,
 * so a ranked list names every value by task and by model. Work with no task and work no one can
 * place go under the first model, and Tuesday has work of no known model.
 */
export const WORLD: TimedStretch[] = [
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
export const opened: string[] = []

/**
 * The page inside a layer that resolves task references, as the app shell provides one, and that
 * says whether a card's read reaches the tasks it names, as the shell does: by default it does.
 */
const Host = defineComponent({
  props: {
    routeState: { type: Object as PropType<Record<string, string>>, default: undefined },
    projectId: { type: String, default: undefined },
    reaches: { type: Boolean, default: true },
  },
  setup(props) {
    provideUsageReach(() => props.reaches)
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

export async function mountPage(
  routeState: Record<string, string>,
  locale: 'en' | 'ru' = 'en',
  projectId?: string,
  reaches = true,
) {
  const host = mount(Host, {
    props: { routeState, projectId, reaches },
    attachTo: document.body,
    global: { plugins: [analyticsI18n(locale)] },
  })
  await flushPromises()
  return host
}

type Written = [Record<string, string>, ('push' | 'replace')?]
export const written = (host: VueWrapper) =>
  host.getComponent(AnalyticsView).emitted<Written>('state') ?? []

/** Goes where the page asked to go, as the shell does with a new address. */
export async function follow(host: VueWrapper) {
  await host.setProps({ routeState: written(host).at(-1)?.[0] })
  await flushPromises()
}

export const taskOpenings = () =>
  vi.mocked(reportAnalyticsUse).mock.calls.filter(([kind]) => kind === 'task_open').length

/** Presses the first task's bar, as a plain click that opens its panel. */
export async function openFirstTask(host: VueWrapper) {
  const link = host.get('.spending-bars a.ranked-line[href="/open/MAIN-1"]')
  expect(link.attributes('aria-label')).toBe('Details of MAIN-1 Task 1')
  await link.trigger('click', { button: 0 })
}

/** The clock, the openings and the page reset for each test. */
export function pressEachTest() {
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
}

/** The side panel over the page, once its address stands: its content, by the hook it documents. */
export const panelOf = (host: VueWrapper) => host.getComponent(ValueDetail)
/** Whether the side panel stands over the page. */
export const panelShown = (host: VueWrapper) => host.findComponent(ValueDetail).exists()

/** The panel's button that adds its value to the page's filter, by what it says. */
export function addButton(host: VueWrapper, words = 'Add to filter') {
  const found = panelOf(host)
    .findAll('button')
    .find((one) => one.text() === words)
  if (!found) throw new Error(`no «${words}» in the panel`)
  return found
}

/** The panel's «Open the card», where the value is a task the app opens. */
export const cardLinks = (host: VueWrapper) =>
  panelOf(host)
    .findAll('a[href]')
    .filter((one) => one.text() === 'Open the card')

/** The address of a value's side panel, as the page writes it. */
export const detailOf = (by: string, value: string | null) => JSON.stringify({ by, value })
