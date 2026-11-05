/**
 * The Work filter is the workspace's and the address follows it. What a reader
 * would see go wrong: a keystroke undone by the route answering an older one,
 * Back not restoring the filter it left, and a filter cut to fit the address
 * shown whole as if a reload would keep it.
 */
import { effectScope, nextTick, shallowRef } from 'vue'

import { describe, expect, test } from 'vitest'

import { usePlanningFilter } from '@/pages/planning/composables/usePlanningFilter.ts'

import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

type RouteState = Record<string, string | number | boolean>

/** A route that answers each write only when told to, as the router does later. */
function harness(initial?: RouteState, maxBytes = 2048) {
  const route = shallowRef<RouteState | undefined>(initial)
  const writes: RouteState[] = []
  const scope = effectScope()
  const filter = scope.run(() =>
    usePlanningFilter({
      state: () => route.value,
      maxBytes: () => maxBytes,
      write: (state) => writes.push(state),
    }),
  )
  if (!filter) throw new Error('the composable needs a scope')
  async function answer(index = writes.length - 1) {
    route.value = writes[index]
    await nextTick()
  }
  async function navigate(state: RouteState | undefined) {
    route.value = state
    await nextTick()
  }
  return { answer, filter, navigate, route, writes, stop: () => scope.stop() }
}

const text = (value: string): WorkFilter => ({ text: value })

describe('the filter and the address', () => {
  test('a reload reads the filter the address holds', () => {
    const { filter } = harness({ view: 'list', labels: 'ui', ready: true, query: 'MAIN' })
    expect(filter.filter.value).toEqual({ text: 'MAIN', ready: true, labels: ['ui'] })
  })

  test('a change of how labels combine is a change of the address, and Reset takes it out', async () => {
    const { answer, filter, writes } = harness({ labels: 'ui,board' })
    filter.set({ ...filter.filter.value, labelsMatch: 'any' })
    expect(writes).toEqual([{ labels: '%any,ui,board' }])
    await answer()
    expect(filter.filter.value.labelsMatch).toBe('any')
    filter.reset()
    expect(writes.at(-1)).toEqual({})
    expect(filter.filter.value.labelsMatch).toBeUndefined()
  })

  test('Back to a link that says any adopts it', async () => {
    const { filter, navigate } = harness()
    await navigate({ labels: '%any,ui,board' })
    expect(filter.filter.value).toEqual({
      text: '',
      labels: ['ui', 'board'],
      labelsMatch: 'any',
    })
  })

  test('a change shows at once and is written with the other keys kept', () => {
    const { filter, writes } = harness({ view: 'list', group: 'epic' })
    filter.set({ text: '', labels: ['ui'] })
    expect(filter.filter.value.labels).toEqual(['ui'])
    expect(writes).toEqual([{ view: 'list', group: 'epic', labels: 'ui' }])
  })

  test('the answer to an older keystroke does not undo a newer one', async () => {
    const { answer, filter, writes } = harness()
    filter.set(text('M'))
    filter.set(text('MA'))
    // The route answers the first write after the second was made.
    await answer(0)
    expect(filter.filter.value.text).toBe('MA')
    await answer(1)
    expect(filter.filter.value.text).toBe('MA')
    expect(writes).toHaveLength(2)
  })

  test('taking back a write still on its way is a write of its own', async () => {
    const { answer, filter, writes } = harness()
    filter.set(text('a'))
    // Cleared before the route answered "a": the route must not keep "a".
    filter.set(text(''))
    expect(writes).toEqual([{ query: 'a' }, {}])
    await answer(0)
    expect(filter.filter.value.text).toBe('')
  })

  test('Back to an address with another filter brings that filter', async () => {
    const { filter, navigate } = harness({ labels: 'ui' })
    filter.set({ text: '', labels: ['ui', 'agent'] })
    await navigate({ kind: 'bug' })
    expect(filter.filter.value).toEqual({ text: '', kind: ['bug'] })
    // A space switch writes an address without the filter; that clears it.
    await navigate(undefined)
    expect(filter.filter.value).toEqual({ text: '' })
  })

  test('says so when the address cannot hold the whole filter', () => {
    const { filter } = harness(undefined, 120)
    const labels = Array.from({ length: 30 }, (_, index) => `label-${index}`)
    filter.set({ text: '', labels })
    // The view keeps every label; the address keeps what fits and says so.
    expect(filter.filter.value.labels).toEqual(labels)
    expect(filter.stored.value).toBe(false)
    filter.reset()
    expect(filter.stored.value).toBe(true)
  })

  test('a view mark clicked twice goes in and comes out again', () => {
    const { filter } = harness()
    filter.toggle({ facet: 'kind', value: 'bug' })
    expect(filter.filter.value.kind).toEqual(['bug'])
    filter.toggle({ facet: 'kind', value: 'bug' })
    expect(filter.filter.value.kind).toBeUndefined()
  })
})
