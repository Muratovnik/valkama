/**
 * The Analytics page and its address, through the page: one view has one address, and a change
 * the address cannot hold is not made. The oracle is the requirement: the same filter chosen in
 * two orders gives one address; a value that would make the address longer than the route holds
 * (240 characters a state string) is refused with words under the filters and to a screen
 * reader, and the address, the reads and the values already chosen stay as they were.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SearchCombobox from '@/shared/ui/SearchCombobox.vue'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
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

/** The field of one dimension's filter. */
const field = (page: VueWrapper, dimension: string) => {
  const found = page
    .findAllComponents(SearchCombobox)
    .find((one) => one.attributes('data-dimension') === dimension)
  if (!found) throw new Error(`no ${dimension} filter`)
  return found
}

/** Chooses `keys` in a dimension's filter, as its field hands them over, in their order. */
async function choose(page: VueWrapper, dimension: string, keys: string[]) {
  field(page, dimension).vm.$emit('update:modelValue', keys)
  await flushPromises()
}

const written = (page: VueWrapper) =>
  page.emitted<[Record<string, string>]>('state')?.map(([state]) => state) ?? []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the address of a view', () => {
  it('is one address for the values of a filter chosen in either order', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const addresses: (string | undefined)[] = []
    for (const order of [
      ['v:model-c', 'none', 'v:model-a'],
      ['v:model-a', 'v:model-c', 'none'],
    ]) {
      const page = await mountAnalytics()
      await choose(page, 'model', order)
      addresses.push(written(page).at(-1)?.filters)
      page.unmount()
    }
    expect(addresses[0]).toBe('{"model":["model-a","model-c",null]}')
    expect(addresses[1]).toBe(addresses[0])
  })

  it('refuses a task that would not fit in the address, says why, and keeps the view', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    // Tasks added one at a time, each written and read back, as a person adds them.
    for (let count = 1; count <= 5; count += 1) {
      await choose(
        page,
        'work_item',
        ids(count).map((id) => `v:${id}`),
      )
      const state = written(page).at(-1)
      expect(JSON.parse(state?.filters ?? '{}')).toEqual({ work_item: ids(count) })
      await page.setProps({ routeState: state })
      await flushPromises()
    }
    expect(page.find('[role="alert"]').exists()).toBe(false)
    const addressed = written(page).length
    const asked = reads.asked.length

    // The sixth task would make the filter longer than its address holds.
    await choose(
      page,
      'work_item',
      ids(6).map((id) => `v:${id}`),
    )
    expect(written(page)).toHaveLength(addressed)
    expect(reads.asked).toHaveLength(asked)
    expect(page.get('[role="alert"]').text()).toBe(
      'The link to this view cannot hold more values of the Task filter, so this one was not added.',
    )
    // The five chosen before still apply: in the field, in the last read and on the tiles.
    expect(field(page, 'work_item').props('modelValue')).toEqual(ids(5).map((id) => `v:${id}`))
    expect(reads.grouped('work_item').at(-1)?.get('work_item')).toBe(ids(5).join(','))
    expect(page.get('.tile-figure[data-measure="time"]').text()).toMatch(/^5\sh$/u)

    // Taking a value out is a change the address holds: the words go with it.
    await choose(
      page,
      'work_item',
      ids(4).map((id) => `v:${id}`),
    )
    await page.setProps({ routeState: written(page).at(-1) })
    expect(page.find('[role="alert"]').exists()).toBe(false)
  })

  it('says the refusal in Russian', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics(
      { routeState: { filters: JSON.stringify({ work_item: ids(5) }) } },
      'ru',
    )
    await choose(
      page,
      'work_item',
      ids(6).map((id) => `v:${id}`),
    )
    expect(written(page)).toEqual([])
    expect(page.get('[role="alert"]').text()).toBe(
      'Ссылка на этот вид не вмещает больше значений фильтра «Задача», поэтому это значение не добавлено.',
    )
  })
})
