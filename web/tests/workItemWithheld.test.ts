/**
 * A ready tile the take-next queue would not give: muted, and its first line ending in a
 * sign and a word for why, the whole sentence its name. The column already says why for
 * work that is not ready and for a goal or stage, so neither code is ever the word, and a
 * blocker that names itself is said as before.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { standsAsTile } from '@/widgets/work-item-views/utils/boardColumns.ts'

import { facetMarks, printsFacet, readinessOf } from '@/entities/work-item/utils/facets.ts'
import { heldBack, withheldReason } from '@/entities/work-item/utils/withheld.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'
import { semanticStatePresentation } from '@/shared/lib/uiSystem.ts'

import { boardGoal, boardItem } from './fixtures/board.ts'

type Code = NonNullable<WorkItemBrief['withheld']>[number]

/** A task in the ready state, which the queue gives from, held back for `codes`. */
const ready = (codes: Code[]) => boardItem(12, 'todo', { withheld: codes })

const only = <T>(marks: T[]): T => {
  assert.equal(marks.length, 1)
  return marks[0] as T
}

describe('a ready tile the queue holds back', () => {
  test('is held back only while it stands ready, open and not workable', () => {
    assert.equal(heldBack(ready(['question'])), true)
    assert.equal(heldBack(ready([])), false)
    assert.equal(heldBack(boardItem(12, 'backlog', { withheld: ['not_ready'] })), false)
    assert.equal(heldBack(boardItem(12, 'dev', { withheld: ['not_ready', 'held'] })), false)
  })

  test('names the first reason its column does not already say', () => {
    assert.equal(withheldReason(ready(['question', 'queue_off'])), 'question')
    assert.equal(withheldReason(ready(['queue_off'])), 'queue_off')
    // A ready item the server withholds only as not ready gives the tile nothing to say.
    assert.equal(withheldReason(ready(['not_ready'])), null)
    assert.equal(readinessOf(ready(['not_ready'])), null)
  })

  test('the tile draws the sign and a word, the sentence its name, in the blocked tone', () => {
    for (const code of ['question', 'queue_off', 'ancestor_deferred'] as const) {
      const mark = only(facetMarks('readiness', 'tile', ready([code])))
      assert.equal(mark.value, 'withheld')
      assert.equal(mark.glyph, 'withheld')
      assert.deepEqual(mark.text, { key: `workItem.withheld.${code}` })
      assert.deepEqual(mark.short, { key: `workItem.withheldShort.${code}` })
      assert.equal(semanticStatePresentation(mark.tone).tone, 'danger')
    }
  })

  test('every code the server sends has its word and its sentence in both languages', () => {
    const codes: Code[] = [
      'held',
      'waits',
      'question',
      'no_start',
      'ancestor_triage',
      'ancestor_deferred',
      'ancestor_cancelling',
      'ancestor_waits',
      'ancestor_closed',
      'queue_off',
      'outside_space',
    ]
    for (const locale of ['en', 'ru'] as const) {
      const { withheld, withheldShort } = messages[locale].workItem
      for (const code of codes) {
        assert.ok(withheld[code as keyof typeof withheld], `${locale} ${code}`)
        assert.ok(withheldShort[code as keyof typeof withheldShort], `${locale} ${code}`)
      }
    }
  })

  test('a blocker it waits on is said as before, not the queue’s word', () => {
    const blocked = ready(['waits'])
    const mark = only(facetMarks('readiness', 'tile', blocked, { waitingOn: 'MAIN-7' }))
    assert.equal(mark.value, 'waiting')
    assert.deepEqual(mark.short, { literal: 'MAIN-7' })
  })

  test('only the tile says it: the list, the card and the graph keep what they said', () => {
    const held = ready(['question'])
    for (const surface of ['list', 'finder', 'chain', 'preview'] as const)
      assert.equal(printsFacet('readiness', surface, held), false, surface)
    // The card says readiness through its primary action, never as a mark.
    assert.deepEqual(facetMarks('readiness', 'card', held), [])
    // The graph keeps the state word where readiness says nothing it prints.
    assert.equal(printsFacet('readiness', 'graph', held), false)
    assert.equal(printsFacet('state', 'graph', held), true)
  })
})

describe('the tiles of goals and stages', () => {
  test('a goal or stage stands as a tile only in triage or put off', () => {
    assert.equal(standsAsTile(boardGoal(1, 'backlog')), true)
    assert.equal(standsAsTile(boardGoal(1, 'done')), false)
    assert.equal(standsAsTile(boardGoal(1, 'backlog', { state: null })), false)
    assert.equal(standsAsTile(boardGoal(1, 'backlog', { kind: 'stage', state: null })), false)
    // Work that holds nothing stands in every column.
    assert.equal(standsAsTile(boardItem(12, 'dev')), true)
    assert.equal(standsAsTile(boardItem(12, 'done')), true)
  })
})
