import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  activeGraphFocus,
  createGraphFocus,
  graphFocusContextKey,
  reduceGraphFocus,
} from '@/widgets/work-item-graph/utils/graphFocus.ts'
import type { GraphFocusContext } from '@/widgets/work-item-graph/utils/graphFocus.ts'

const context = (showDone = false, version = 1): GraphFocusContext => ({
  open: true,
  board: 'alpha',
  version,
  scopeKind: 'all',
  epicId: null,
  showDone,
})

test('pointer leave clears the node in both Open Only and All projections', () => {
  for (const showDone of [false, true]) {
    let state = createGraphFocus(context(showDone))
    state = reduceGraphFocus(state, { type: 'pointer-enter', id: 12 })
    assert.equal(activeGraphFocus(state), 12)
    state = reduceGraphFocus(state, { type: 'pointer-leave', id: 12 })
    assert.equal(activeGraphFocus(state), null)
  }
})

test('id-guarded leave and blur cannot clear a newer pointer or focus target', () => {
  let state = createGraphFocus(context())
  state = reduceGraphFocus(state, { type: 'pointer-enter', id: 12 })
  state = reduceGraphFocus(state, { type: 'pointer-enter', id: 13 })
  state = reduceGraphFocus(state, { type: 'pointer-leave', id: 12 })
  assert.equal(state.hovered, 13)

  state = reduceGraphFocus(state, { type: 'focus', id: 21 })
  state = reduceGraphFocus(state, { type: 'focus', id: 22 })
  state = reduceGraphFocus(state, { type: 'blur', id: 21 })
  assert.equal(state.focused, 22)
})

test('pointer and keyboard focus remain separate and the active input modality wins visually', () => {
  let state = createGraphFocus(context())
  state = reduceGraphFocus(state, { type: 'pointer-enter', id: 12 })
  state = reduceGraphFocus(state, { type: 'focus', id: 21 })
  assert.equal(state.hovered, 12)
  assert.equal(state.focused, 21)
  assert.equal(activeGraphFocus(state), 21)
  state = reduceGraphFocus(state, { type: 'pointer-enter', id: 12 })
  assert.equal(activeGraphFocus(state), 12)
  state = reduceGraphFocus(state, { type: 'pointer-leave', id: 12 })
  assert.equal(state.focused, 21)
  assert.equal(activeGraphFocus(state), 21)
})

test('field leave clears only transient hover, while reset clears every focus on context changes', () => {
  let state = createGraphFocus(context())
  state = reduceGraphFocus(state, { type: 'pointer-enter', id: 12 })
  state = reduceGraphFocus(state, { type: 'focus', id: 21 })
  state = reduceGraphFocus(state, { type: 'field-leave' })
  assert.equal(state.hovered, null)
  assert.equal(state.focused, 21)
  assert.equal(state.active, 'focus')

  const next = context(true, 2)
  state = reduceGraphFocus(state, { type: 'reset', context: next })
  assert.deepEqual(state, { ...next, hovered: null, focused: null, active: null })
  assert.notEqual(graphFocusContextKey(context()), graphFocusContextKey(next))
  assert.notEqual(graphFocusContextKey(next), graphFocusContextKey({ ...next, open: false }))
})

test('board and scope changes reset a newer projection instead of carrying stale focus', () => {
  let state = createGraphFocus(context())
  state = reduceGraphFocus(state, { type: 'pointer-enter', id: 12 })
  state = reduceGraphFocus(state, { type: 'focus', id: 21 })
  const next: GraphFocusContext = {
    ...context(true, 9),
    board: 'beta',
    scopeKind: 'epic',
    epicId: 42,
  }
  state = reduceGraphFocus(state, { type: 'reset', context: next })
  assert.deepEqual(state, { ...next, hovered: null, focused: null, active: null })
  assert.notEqual(graphFocusContextKey(context()), graphFocusContextKey(next))
})
