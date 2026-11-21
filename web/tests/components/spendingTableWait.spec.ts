/**
 * The wait of a breakdown crossed with a second dimension, while that read lands. The oracle is
 * the rule every read wait keeps: nothing on screen for the first 500 ms, then the shared word for
 * at least 200 ms, and the table held away for that minimum. The page says the word once for all of
 * its waits (`analytics-read-wait`, see the view's spec); a read that fails says so in its alert.
 * A read again of the pairs on show that fails keeps them, and says so in room the heading row kept
 * for it (DESIGN.md § Analytics: nothing moves when a failure is said or when the next answer
 * replaces it).
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'
import type { CrossRead } from '@/pages/analytics/composables/useCrossRead.ts'

import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'

import { task, usageAnswer, value } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

/** Two values of work in one period, by task and by model: what the table is crossed from. */
const read = usageAnswer({
  first: new Date(2026, 10, 9),
  days: 1,
  groupBy: ['work_item', 'model'],
  stretches: [
    {
      day: 0,
      group: { work_item: task(1, 'One'), model: value('model-a') },
      spend: { seconds: 600 },
    },
    {
      day: 0,
      group: { work_item: task(2, 'Two'), model: value('model-b') },
      spend: { seconds: 300 },
    },
  ],
}).usage

/** The table crossed with model, in the state of its crossed read. */
const crossedTable = (cross: CrossRead) =>
  mount(SpendingTable, {
    props: {
      across: 'model' as const,
      by: 'work_item' as const,
      cross,
      dimensions: ['work_item', 'model', 'role'] as const,
      filters: {},
      measure: 'time' as const,
      usage: read,
    },
    global: { plugins: [analyticsI18n()] },
  })

describe("the crossed read's wait", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows its words once it has lasted, and holds the table away for the minimum', async () => {
    const wrapper = crossedTable({ status: 'reading', usage: null })
    const words = () => wrapper.get('.spending-table-reading').text()
    expect(words()).toBe('')
    vi.advanceTimersByTime(LOADING_DELAY_MS - 1)
    await wrapper.vm.$nextTick()
    expect(words()).toBe('')
    vi.advanceTimersByTime(1)
    await wrapper.vm.$nextTick()
    expect(words()).toBe('Loading')

    await wrapper.setProps({ cross: { status: 'ready', usage: read } })
    // The table waits for the minimum the words were shown for, then takes their place.
    expect(wrapper.find('table').exists()).toBe(false)
    expect(words()).toBe('Loading')
    vi.advanceTimersByTime(LOADING_MIN_SHOWN_MS - 1)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('table').exists()).toBe(false)
    vi.advanceTimersByTime(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('table').exists()).toBe(true)
  })

  it('shows nothing for a read that answers inside the delay', async () => {
    const wrapper = crossedTable({ status: 'reading', usage: null })
    vi.advanceTimersByTime(LOADING_DELAY_MS - 1)
    await wrapper.vm.$nextTick()
    await wrapper.setProps({ cross: { status: 'ready', usage: read } })
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.find('.spending-table-reading').exists()).toBe(false)
  })
})

/** Each row's name, in the table's order. */
const names = (wrapper: ReturnType<typeof crossedTable>) =>
  wrapper.findAll('tbody th').map((cell) => cell.text().replaceAll(/\s+/gu, ' ').trim())

describe("the crossed read's read again", () => {
  it('keeps its pairs when it fails, and says so in room the heading row kept', async () => {
    const shown = crossedTable({ status: 'ready', usage: read })
    const pairs = names(shown)
    expect(pairs).toHaveLength(2)
    const failure = () => shown.get('.spending-table-head [role="status"]')
    // Held unseen while the pairs stand and nothing failed.
    expect(failure().classes()).toContain('refresh-failed-held')

    await shown.setProps({ cross: { status: 'reading', usage: read } })
    await shown.setProps({ cross: { status: 'failed', usage: read } })
    expect(names(shown), 'the pairs it showed stay').toEqual(pairs)
    expect(shown.find('[role="alert"]').exists()).toBe(false)
    expect(failure().classes()).not.toContain('refresh-failed-held')
    expect(failure().text().replaceAll(/\s+/gu, ' ').trim()).toBe('Could not refresh · Retry')
    await failure().get('button').trigger('click')
    expect(shown.emitted('reread')).toHaveLength(1)
  })
})
