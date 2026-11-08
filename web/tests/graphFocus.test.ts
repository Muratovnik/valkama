import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  createGraphFocus,
  graphFocusContextKey,
  reduceGraphFocus,
} from '@/widgets/work-item-graph/utils/graphFocus.ts'
import type { GraphFocusContext } from '@/widgets/work-item-graph/utils/graphFocus.ts'

const context = (showDone = false, version = 1): GraphFocusContext => ({
  open: true,
  space: 'alpha',
  version,
  scopeKind: 'all',
  epicId: null,
  showDone,
})

test('blur clears the focused node in both Open Only and All projections', () => {
  for (const showDone of [false, true]) {
    let state = createGraphFocus(context(showDone))
    state = reduceGraphFocus(state, { type: 'focus', id: '12' })
    assert.equal(state.focused, '12')
    state = reduceGraphFocus(state, { type: 'blur', id: '12' })
    assert.equal(state.focused, null)
  }
})

test('an id-guarded blur cannot clear a newer focus target', () => {
  let state = createGraphFocus(context())
  state = reduceGraphFocus(state, { type: 'focus', id: '21' })
  state = reduceGraphFocus(state, { type: 'focus', id: '22' })
  state = reduceGraphFocus(state, { type: 'blur', id: '21' })
  assert.equal(state.focused, '22')
})

test('the focus state holds no pointer hover, so a pointer cannot light or dim the field', () => {
  const state = reduceGraphFocus(createGraphFocus(context()), { type: 'focus', id: '21' })
  assert.deepEqual(Object.keys(state).sort(), [...Object.keys(context()), 'focused'].sort())
})

test('space and scope changes reset a newer projection instead of carrying stale focus', () => {
  let state = createGraphFocus(context())
  state = reduceGraphFocus(state, { type: 'focus', id: '21' })
  const next: GraphFocusContext = {
    ...context(true, 9),
    space: 'beta',
    scopeKind: 'epic',
    epicId: '42',
  }
  state = reduceGraphFocus(state, { type: 'reset', context: next })
  assert.deepEqual(state, { ...next, focused: null })
  assert.notEqual(graphFocusContextKey(context()), graphFocusContextKey(next))
  assert.notEqual(graphFocusContextKey(next), graphFocusContextKey({ ...next, open: false }))
  assert.notEqual(
    graphFocusContextKey(context()),
    graphFocusContextKey({ ...context(), space: 'beta' }),
  )
})
