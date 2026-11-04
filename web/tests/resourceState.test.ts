import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  beginResource,
  cancelResource,
  createResource,
  holdsResource,
  rejectResource,
  resolveResource,
  resourceSelection,
} from '@/shared/api/resourceState.ts'

test('a key switch isolates the pending selector from the previously committed payload', () => {
  const initial = resolveResource(beginResource(createResource<string[]>(), 'alpha'), 1, 'alpha', [
    'a',
  ])
  const refreshing = beginResource(initial, 'beta')

  assert.equal(refreshing.status, 'loading')
  assert.equal(refreshing.key, null)
  assert.equal(resourceSelection(refreshing), 'beta')
  assert.equal(refreshing.data, null)

  const committed = resolveResource(refreshing, 2, 'beta', ['b'])
  assert.equal(committed.status, 'ready')
  assert.equal(committed.key, 'beta')
  assert.equal(committed.pendingKey, null)
  assert.deepEqual(committed.data, ['b'])
  assert.equal(resourceSelection(committed), 'beta')
})

test('a failed key switch cannot reveal the abandoned key payload', () => {
  const initial = resolveResource(beginResource(createResource<string[]>(), 'alpha'), 1, 'alpha', [
    'a',
  ])
  const refreshing = beginResource(initial, 'beta')
  const failed = rejectResource(refreshing, 2, 'beta', 'network down')

  assert.equal(failed.status, 'error')
  assert.equal(failed.key, null)
  assert.equal(failed.pendingKey, null)
  assert.equal(resourceSelection(failed), '')
  assert.equal(failed.data, null)
  assert.equal(failed.error, 'network down')
})

test('a disconnect after a committed response is reconnecting transport, not a rollback', () => {
  const committed = resolveResource(
    beginResource(createResource<string[]>(), 'alpha'),
    1,
    'alpha',
    ['a'],
  )
  assert.strictEqual(rejectResource(committed, 1, 'alpha', 'socket closed'), committed)
  assert.equal(committed.status, 'ready')
  assert.deepEqual(committed.data, ['a'])
})

test('stale responses and errors cannot overwrite a newer generation', () => {
  const initial = resolveResource(beginResource(createResource<string[]>(), 'alpha'), 1, 'alpha', [
    'a',
  ])
  const first = beginResource(initial, 'beta')
  const second = beginResource(first, 'delta')

  assert.strictEqual(resolveResource(second, 2, 'beta', ['stale']), second)
  assert.strictEqual(rejectResource(second, 2, 'beta', 'stale failure'), second)

  const committed = resolveResource(second, 3, 'delta', ['d'])
  assert.equal(committed.key, 'delta')
  assert.deepEqual(committed.data, ['d'])
})

test('cancelling a switched key invalidates callbacks without restoring abandoned content', () => {
  const initial = resolveResource(beginResource(createResource<string[]>(), 'alpha'), 1, 'alpha', [
    'a',
  ])
  const refreshing = beginResource(initial, 'beta')
  const cancelled = cancelResource(refreshing)

  assert.equal(cancelled.status, 'idle')
  assert.equal(cancelled.key, null)
  assert.equal(cancelled.pendingKey, null)
  assert.equal(cancelled.data, null)
  assert.strictEqual(resolveResource(cancelled, refreshing.generation, 'beta', ['late']), cancelled)
})

test('a push of what is already held, settled under its key, is no news', () => {
  const held = resolveResource(
    beginResource(createResource<{ a: number[] }>(), 'alpha'),
    1,
    'alpha',
    {
      a: [1],
    },
  )
  assert.equal(holdsResource(held, 'alpha', { a: [1] }), true)
  assert.equal(holdsResource(held, 'alpha', { a: [2] }), false)
  assert.equal(holdsResource(held, 'beta', { a: [1] }), false)
  // A read on the way may bring something else: the push is taken.
  assert.equal(holdsResource(beginResource(held, 'alpha'), 'alpha', { a: [1] }), false)
  assert.equal(holdsResource(createResource<{ a: number[] }>(), 'alpha', { a: [1] }), false)
})
