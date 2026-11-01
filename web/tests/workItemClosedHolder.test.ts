/**
 * Who held finished work, once a close no longer leaves the claim on it.
 *
 * The server ends an item's claim in the write that closes it and names the
 * holder at that moment as `last_claim_ref`. The holder facet reads that for a
 * finished item, and the claim itself for open work, so a closed item still
 * says «Ранее отвечал» and an item an older build closed with its claim still
 * on it reads the same.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { facetMarks, holderRef, printsFacet } from '@/entities/work-item/utils/facets.ts'
import type { FacetSurface } from '@/entities/work-item/utils/facets.ts'

import { boardItem } from './fixtures/board.ts'

const SESSION = 'claude (session 5937aa01-1234-4c00)'
const SHORT = 'claude · 5937aa01-1234'
const SURFACES: readonly FacetSurface[] = ['tile', 'list', 'graph', 'card', 'finder']

const only = (marks: ReturnType<typeof facetMarks>) => {
  assert.equal(marks.length, 1, `expected one mark, got ${marks.length}`)
  return marks[0]
}

describe('the holder of finished work', () => {
  test('a close ends the claim, and the holder at the close is still said to have held it', () => {
    const closed = boardItem(12, 'done', { last_claim_ref: SESSION })
    assert.deepEqual(
      SURFACES.filter((surface) => printsFacet('holder', surface, closed)),
      ['list', 'graph', 'card'],
    )
    for (const surface of ['list', 'card'] as const) {
      const mark = only(facetMarks('holder', surface, closed))
      assert.deepEqual(mark.text, {
        key: 'workItem.previousHolder',
        params: { holder: SHORT },
      })
      assert.equal(mark.glyph, 'holder', surface)
      assert.equal(mark.quiet, false, surface)
    }
  })

  test('an item closed with its claim still on it reads that claim as its former holder', () => {
    const closed = boardItem(12, 'done', { claim_ref: SESSION, claim_state: 'live' })
    assert.equal(holderRef(closed), SESSION)
    assert.deepEqual(only(facetMarks('holder', 'card', closed)).text, {
      key: 'workItem.previousHolder',
      params: { holder: SHORT },
    })
  })

  test('finished work closed unheld names nobody', () => {
    const unheld = boardItem(12, 'done', { last_claim_ref: null })
    assert.equal(holderRef(unheld), '')
    assert.deepEqual(only(facetMarks('holder', 'list', unheld)).text, { literal: '—' })
    assert.deepEqual(only(facetMarks('holder', 'card', unheld)).text, {
      key: 'workItem.noClaim',
    })
  })

  test('open work names its claim, never a former holder', () => {
    const reopened = boardItem(12, 'dev', { last_claim_ref: SESSION })
    assert.equal(holderRef(reopened), '')
    assert.deepEqual(only(facetMarks('holder', 'card', reopened)).text, {
      key: 'workItem.noClaim',
    })
    const held = boardItem(12, 'dev', { claim_ref: SESSION, claim_state: 'live' })
    assert.deepEqual(only(facetMarks('holder', 'card', held)).text, { literal: SHORT })
  })
})
