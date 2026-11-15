/**
 * Where an item stands, as every surface marks it: the state it stands in, or, for an accepted
 * open goal or stage, which stands in none, what it derives from the work under it. The mark's
 * value, words and tone come from the one reading of the two (`standingOf`).
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { facetMarks, printsFacet } from '@/entities/work-item/utils/facets.ts'
import type { FacetMark } from '@/entities/work-item/utils/facets.ts'
import { stateMark } from '@/entities/work-item/utils/standingMark.ts'

import { standingOf } from '@/shared/lib/standing.ts'

import { boardItem } from './fixtures/board.ts'

const item = (overrides: Parameters<typeof boardItem>[2]) => boardItem(12, 'backlog', overrides)

function only(marks: FacetMark[]): FacetMark {
  assert.equal(marks.length, 1)
  return marks[0]
}

describe('the state mark', () => {
  test('marks an accepted open goal or stage is marked with the standing it derives, wherever it prints', () => {
    for (const derived of ['not_started', 'in_progress', 'awaiting_confirmation'] as const) {
      const goal = item({ kind: 'goal', state: null, container_state: derived, workable: false })
      for (const surface of ['list', 'graph', 'card', 'finder'] as const) {
        const mark = only(facetMarks('state', surface, goal))
        assert.equal(mark.value, derived)
        assert.deepEqual(mark.text, { key: `workItem.containerState.${derived}` })
        assert.deepEqual(mark.tone, { dimension: 'work-item-state', state: derived })
      }
    }
    // Not started is the norm of a board's goals, so a lane says only a standing that moved.
    const started = item({ kind: 'goal', state: null, container_state: 'in_progress' })
    const waiting = item({ kind: 'goal', state: null, container_state: 'not_started' })
    assert.equal(printsFacet('state', 'lane', started), true)
    assert.equal(printsFacet('state', 'lane', waiting), false)
  })

  test('marks a state by the state, its category the tone', () => {
    const task = item({})
    const mark = stateMark(task, 'glyph-word')
    assert.equal(mark.value, 'triage')
    assert.deepEqual(mark.text, { state: task.state })
    assert.deepEqual(mark.tone, { dimension: 'work-item-state', state: 'triage' })
  })

  test('reads a record that says neither a state nor a derived one as not started, as every surface does', () => {
    const neither = { state: null, container_state: null }
    assert.equal(standingOf(neither), 'not_started')
    assert.equal(stateMark(neither, 'glyph-word').value, 'not_started')
  })
})
