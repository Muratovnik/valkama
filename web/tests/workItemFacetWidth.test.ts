/**
 * The width a list row is printed for. A row reads the list's width only through
 * `markWidth`, so that a resize between two of the widths the facets change at
 * neither changes nor redraws what the rows print.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { markWidth, surfaceMarks } from '@/entities/work-item/utils/facets.ts'

import { boardItem } from './fixtures/board.ts'

const dressed = boardItem(7, 'dev', {
  claim_ref: 'codex (session 7f3a)',
  labels: ['a', 'b', 'c', 'd', 'e'],
  priority: 'high',
})
const printed = (width: number) =>
  surfaceMarks('list', dressed, { width }).map((mark) => mark.value)

describe('the width a list row is printed for', () => {
  test('prints what the full width prints', () => {
    for (const width of [0, 320, 899, 900, 901, 1000, 1440])
      assert.deepEqual(printed(markWidth('list', width)), printed(width), `${width}`)
  })

  test('changes only where the labels come in, at 900', () => {
    assert.equal(markWidth('list', 1000), markWidth('list', 1440))
    assert.equal(markWidth('list', 0), markWidth('list', 899))
    assert.notEqual(markWidth('list', 899), markWidth('list', 900))
    assert.notDeepEqual(printed(899), printed(900))
  })
})
