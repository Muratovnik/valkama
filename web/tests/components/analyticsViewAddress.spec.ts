/**
 * The Analytics page and its address, through the page: one view has one address, and a change
 * the address cannot hold is not made. The oracle is the requirement: the same filter chosen in
 * two orders gives one address; a value that would make the address longer than the route holds
 * (240 characters a state string) is refused with words under the filters and to a screen
 * reader, and the address, the reads and the values already chosen stay as they were.
 */
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { chosenRows, openDimension, pressRow } from '../support/analyticsFilter.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)

/** Six tasks with an hour each this Monday, each under its own model. */
const TASKS = Array.from({ length: 6 }, (_, index) => task(index + 1, `Task ${index + 1}`))
const WORLD: TimedStretch[] = TASKS.map((one, index) => ({
  at: new Date(2026, 10, 9, 10),
  group: { work_item: one, model: value(`model-${'abcdef'[index]}`) },
  spend: { seconds: 3600 },
}))

const ids = (count: number) => TASKS.slice(0, count).map((one) => one.id ?? '')

/** How the filter's menu names the task of a place in `TASKS`. */
const taskRow = (place: number) => `MAIN-${place + 1} Task ${place + 1}`

const written = (page: VueWrapper) =>
  page.emitted<[Record<string, string>]>('state')?.map(([state]) => state) ?? []

/**
 * Presses the rows of `values` in the menu on show, in their order, and opens the page at each
 * address a press writes, as the route does.
 */
async function press(page: VueWrapper, values: string[]) {
  for (const words of values) {
    const before = written(page).length
    await pressRow(page, words)
    if (written(page).length > before) {
      await page.setProps({ routeState: written(page).at(-1) })
      await flushPromises()
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
// Registered after the restore, so it runs before it: a page left open reads again once its view
// changes, and a read asked after the stand-in is gone goes to the DOM's own fetch, which the
// environment aborts at teardown with a trace.
enableAutoUnmount(afterEach)

describe('the address of a view', () => {
  it('is one address for the values of a filter chosen in either order', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const addresses: (string | undefined)[] = []
    for (const order of [
      ['model-c', 'Unknown', 'model-a'],
      ['model-a', 'model-c', 'Unknown'],
    ]) {
      const page = await mountAnalytics()
      await openDimension(page, 'Model')
      await press(page, order)
      addresses.push(written(page).at(-1)?.filters)
      page.unmount()
    }
    expect(addresses[0]).toBe('{"model":["model-a","model-c",null]}')
    expect(addresses[1]).toBe(addresses[0])
  })

  it('refuses a task that would not fit in the address, says why, and keeps the view', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    await openDimension(page, 'Task')
    // Tasks added one at a time, each written and read back, as a person adds them.
    for (let count = 1; count <= 5; count += 1) {
      await press(page, [taskRow(count - 1)])
      expect(JSON.parse(written(page).at(-1)?.filters ?? '{}')).toEqual({ work_item: ids(count) })
    }
    expect(page.find('[role="alert"]').exists()).toBe(false)
    const addressed = written(page).length
    const asked = reads.asked.length

    // The sixth task would make the filter longer than its address holds.
    await press(page, [taskRow(5)])
    expect(written(page)).toHaveLength(addressed)
    expect(reads.asked).toHaveLength(asked)
    expect(page.get('[role="alert"]').text()).toBe(
      'The link to this view cannot hold more values of the Task filter, so this one was not added.',
    )
    // The five chosen before still apply: in the menu, in the last read and on the tiles.
    expect(chosenRows(page)).toEqual([0, 1, 2, 3, 4].map((place) => taskRow(place)))
    expect(reads.grouped('work_item').at(-1)?.get('work_item')).toBe(ids(5).join(','))
    expect(page.get('.tile-figure[data-measure="time"]').text()).toMatch(/^5\sh$/u)

    // Taking a value out is a change the address holds: the words go with it.
    await press(page, [taskRow(4)])
    expect(JSON.parse(written(page).at(-1)?.filters ?? '{}')).toEqual({ work_item: ids(4) })
    expect(page.find('[role="alert"]').exists()).toBe(false)
  })

  it('says the refusal in Russian', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics(
      { routeState: { filters: JSON.stringify({ work_item: ids(5) }) } },
      'ru',
    )
    await openDimension(page, 'Задача')
    await press(page, [taskRow(5)])
    expect(written(page)).toEqual([])
    expect(page.get('[role="alert"]').text()).toBe(
      'Ссылка на этот вид не вмещает больше значений фильтра «Задача», поэтому это значение не добавлено.',
    )
  })
})
