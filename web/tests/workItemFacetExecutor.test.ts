/**
 * A tile's holder as its executor: the client that holds the item, by its own glyph, and
 * what its session is doing, as the side panel says it — never a person's glyph for a
 * claim no session stands behind. The holder's other surfaces are in `workItemFacets`.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { facetMarks, printsFacet } from '@/entities/work-item/utils/facets.ts'
import type { FacetSurface } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { boardItem } from './fixtures/board.ts'

const SURFACES: readonly FacetSurface[] = ['tile', 'list', 'graph', 'card', 'finder']
const CLAUDE = 'claude (session 5937aa01-1234-4c00)'
const params = { holder: 'claude · 5937aa01-1234' }

const held = (overrides: Partial<WorkItemBrief> = {}) =>
  boardItem(12, 'dev', { claim_ref: CLAUDE, claim_state: 'live', ...overrides })

const tileMark = (item: WorkItemBrief, context = {}) => {
  const marks = facetMarks('holder', 'tile', item, context)
  assert.equal(marks.length, 1, `expected one mark, got ${marks.length}`)
  return marks[0]
}

describe('the executor on a tile', () => {
  test('is the client, with its session running, held on other work, asking or waiting', () => {
    const cases = [
      [{ state: 'working' }, 'working', 'workItem.facet.heldWorking'],
      [{ state: 'held' }, 'held', 'workItem.facet.heldElsewhere'],
      // A session stopped in the middle of a turn for a person is apart from one whose turn
      // is over, long or not.
      [{ state: 'waiting', long: false, asks: true }, 'asks', 'workItem.facet.heldAsking'],
      [{ state: 'waiting', long: true, asks: true }, 'asks', 'workItem.facet.heldAsking'],
      [{ state: 'waiting', long: false, asks: false }, 'waiting', 'workItem.facet.heldWaiting'],
      [{ state: 'waiting', long: true, asks: false }, 'waiting', 'workItem.facet.heldWaiting'],
    ] as const
    for (const [live, session, key] of cases) {
      const mark = tileMark(held(), { live })
      assert.equal(mark.glyph, 'claude', session)
      assert.equal(mark.session, session)
      assert.deepEqual(mark.text, { key, params })
    }
  })

  test('says a session asks in both languages, apart from the wait whose turn is over', () => {
    for (const locale of ['en', 'ru'] as const) {
      const words = messages[locale].workItem.facet
      assert.ok(words.heldAsking.includes('{holder}'), locale)
      assert.notEqual(words.heldAsking, words.heldWaiting, locale)
    }
  })

  test('of a silent session draws no sign, as a claim with no session at it does not', () => {
    const quiet = tileMark(held(), {
      live: { state: 'quiet', quiet_since: '2026-11-01T10:00:00Z' },
    })
    assert.equal(quiet.session, undefined)
    assert.equal(tileMark(held()).session, undefined)
  })

  test('is drawn by its client: Codex by its own glyph, any other as a client', () => {
    const codex = held({ claim_ref: 'codex (session 019a2b3c-4d5e-7f00)' })
    assert.equal(tileMark(codex).glyph, 'codex')
    const other = held({ claim_ref: 'cursor (session 7a1b2c3d-0000)' })
    assert.equal(tileMark(other).glyph, 'client')
    const idle = tileMark(held())
    assert.equal(idle.glyph, 'claude')
    assert.equal(idle.session, undefined)
    assert.deepEqual(idle.text, { key: 'workItem.facet.heldBy', params })
  })

  test('of a stale claim keeps its client and says it is stale, not what a session does', () => {
    const mark = tileMark(held({ claim_state: 'stale' }), { live: { state: 'working' } })
    assert.equal(mark.glyph, 'claude')
    assert.equal(mark.session, undefined)
    assert.deepEqual(mark.text, { key: 'workItem.facet.heldStale', params })
  })

  test('of an unconfirmed claim is drawn only while a session is at work on it', () => {
    const unconfirmed = held({ claim_state: 'unconfirmed' })
    const tile = (context: object) => printsFacet('holder', 'tile', unconfirmed, context)
    assert.deepEqual(
      SURFACES.filter((surface) => printsFacet('holder', surface, unconfirmed, {})),
      ['list', 'graph', 'card'],
    )
    assert.equal(tile({ live: { state: 'quiet', quiet_since: '2026-11-01T10:00:00Z' } }), false)
    assert.equal(tile({ live: { state: 'working' } }), true)
    assert.equal(tileMark(unconfirmed, { live: { state: 'working' } }).session, 'working')
  })
})
