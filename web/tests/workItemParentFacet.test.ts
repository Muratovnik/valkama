/**
 * The parent as the card names it. Any item may hold others, one level deep, so the card
 * draws the parent by its own kind: an epic by the epic's sign, a bug or an improvement by
 * theirs, each in its kind's ink; a plain task has no sign of its own and takes the generic
 * parent's, still in the task's ink. Every parent was drawn as an epic and called one.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { facetMarks } from '@/entities/work-item/utils/facets.ts'

import { boardItem } from './fixtures/board.ts'

const child = boardItem(12, 'backlog', { parent_id: boardItem(3).work_item_id })
const context = { parentReference: 'MAIN-3' }

const cardMark = (parentKind?: 'task' | 'bug' | 'epic' | 'improvement') => {
  const marks = facetMarks('parent', 'card', child, { ...context, parentKind })
  assert.equal(marks.length, 1)
  return marks[0]
}

describe('the parent on the card', () => {
  test("is drawn by the parent's own kind, in that kind's ink", () => {
    const cases = [
      { kind: 'epic', glyph: 'kind-epic' },
      { kind: 'bug', glyph: 'kind-bug' },
      { kind: 'improvement', glyph: 'kind-improvement' },
      { kind: 'task', glyph: 'parent' },
    ] as const
    for (const { kind, glyph } of cases) {
      const mark = cardMark(kind)
      assert.equal(mark.glyph, glyph, kind)
      assert.equal(mark.ink, kind, kind)
      assert.deepEqual(mark.text, { key: `workItem.kind.${kind}` }, kind)
      assert.equal(mark.value, 'MAIN-3', kind)
    }
  })

  test('whose kind the card does not know is named a parent, never an epic', () => {
    const mark = cardMark()
    assert.equal(mark.glyph, 'parent')
    assert.equal(mark.ink, undefined)
    assert.deepEqual(mark.text, { key: 'workItem.parent' })
  })

  test('elsewhere is still the generic sign and the reference', () => {
    const [tile] = facetMarks('parent', 'tile', child, { ...context, parentKind: 'epic' })
    assert.equal(tile?.glyph, 'parent')
    assert.deepEqual(tile?.text, { literal: 'MAIN-3' })
  })
})
