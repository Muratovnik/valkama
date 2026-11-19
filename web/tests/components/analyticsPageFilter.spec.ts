/**
 * Adding a value to the Analytics page's filter (`usePageFilter`), the one operation the filter's
 * field, a value's side panel and an account of the quota share. The oracle is the requirement: a
 * value joins the values its dimension's filter holds — A, B and then C is A, B, C — and nothing
 * else of the view changes; a value held already is no change; a view whose address cannot hold
 * the filter is not written, and the page says why under its filters unless the side panel asked,
 * which says it itself. From the panel the step closes it, a new place in the history.
 */
import { defineComponent, h } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { providePageFilter } from '@/pages/analytics/composables/usePageFilter.ts'

import { DEFAULT_VIEW } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'

const drawNothing = () => h('div')

/** A page whose address holds at most `room` filter values, what it wrote and what it refused. */
function page(filters: UsageFilters, room = Infinity) {
  const writes: [Partial<AnalyticsView>, 'push' | 'replace'][] = []
  const refused: UsageDimension[] = []
  let operations: ReturnType<typeof providePageFilter> | null = null
  const view: AnalyticsView = { ...DEFAULT_VIEW, by: 'model', filters }
  function change(next: Partial<AnalyticsView>, mode: 'push' | 'replace') {
    const held = Object.values(next.filters ?? {}).flat().length
    if (held > room) return false
    writes.push([next, mode])
    return true
  }
  function full(dimension: UsageDimension) {
    refused.push(dimension)
  }
  mount(
    defineComponent({
      setup() {
        operations = providePageFilter({ change, full, view: () => view })
        return drawNothing
      },
    }),
  )
  if (!operations) throw new Error('the page gave no filter')
  return { filter: operations as ReturnType<typeof providePageFilter>, writes, refused }
}

describe('adding a value to the page’s filter', () => {
  it('starts a dimension’s filter with the value where it had none, in place', () => {
    const { filter, writes } = page({})
    expect(filter.add('account', 'org-a')).toBe('added')
    expect(writes).toEqual([[{ filters: { account: ['org-a'] } }, 'replace']])
  })

  it('adds the value beside the values the filter holds and keeps the other filters', () => {
    const { filter, writes } = page({ model: ['model-b'], account: ['org-a', 'org-c'] })
    expect(filter.add('account', 'org-b')).toBe('added')
    expect(writes).toEqual([
      [{ filters: { account: ['org-a', 'org-b', 'org-c'], model: ['model-b'] } }, 'replace'],
    ])
  })

  it('adds work with no value in the dimension after the ids, as «none» stands', () => {
    const { filter, writes } = page({ work_item: ['a1'] })
    expect(filter.add('work_item', null)).toBe('added')
    expect(writes[0]?.[0].filters).toEqual({ work_item: ['a1', null] })
  })

  it('writes nothing for a value the filter holds already', () => {
    const { filter, writes, refused } = page({ account: ['org-a'], work_item: [null] })
    expect(filter.has('account', 'org-a')).toBe(true)
    expect(filter.has('account', 'org-b')).toBe(false)
    expect(filter.add('account', 'org-a')).toBe('present')
    expect(filter.add('work_item', null, true)).toBe('present')
    expect(writes).toEqual([])
    expect(refused).toEqual([])
  })

  it('writes nothing where the address cannot hold one more value, and says so under the filters', () => {
    const { filter, writes, refused } = page({ account: ['org-a', 'org-b'] }, 2)
    expect(filter.add('account', 'org-c')).toBe('full')
    expect(writes).toEqual([])
    expect(refused).toEqual(['account'])
  })

  it('leaves the refusal to the side panel it was asked in', () => {
    const { filter, writes, refused } = page({ account: ['org-a', 'org-b'] }, 2)
    expect(filter.add('account', 'org-c', true)).toBe('full')
    expect(writes).toEqual([])
    expect(refused).toEqual([])
  })

  it('closes the side panel it was asked in, in the same new place', () => {
    const { filter, writes } = page({ model: ['model-a'] })
    expect(filter.add('model', 'model-b', true)).toBe('added')
    expect(writes).toEqual([[{ filters: { model: ['model-a', 'model-b'] }, detail: null }, 'push']])
  })
})
