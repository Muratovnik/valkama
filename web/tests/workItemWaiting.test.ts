/**
 * What an item waits on, read from the links a view carries. The expectations
 * follow the link contract: a block holds while its source is open; a view's
 * links and a chain's edges name the source's state wherever it lives; a link
 * from a server that predates that says nothing, so its source is looked up
 * among the items; unknown is never open.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { waitingOn } from '@/entities/work-item/utils/waiting.ts'

import { validateReadModel } from '@/shared/api/planningModel.ts'
import type { PlanningEdge } from '@/shared/api/planningModel.ts'

import { planningReadModel } from './browser/planningFixtures.ts'
import { boardId, boardItem } from './fixtures/board.ts'

const blocked = boardItem(1)
const openHere = boardItem(2, 'dev')
const doneHere = boardItem(3, 'done')
const FOREIGN = '00000000-0000-4000-8000-000000009999'

const known = (open: boolean, name = open ? 'Review' : 'Done') => ({
  state_name: name,
  state_category: open ? ('review' as const) : ('completed' as const),
  is_terminal: !open,
  state_unavailable: null,
})

const block = (from: string, extra: Partial<PlanningEdge> = {}): PlanningEdge => ({
  from,
  to: blocked.work_item_id,
  kind: 'blocks',
  ...extra,
})

const items = [blocked, openHere, doneHere]

test('an open blocker in another space names the item waiting on it', () => {
  const links = [block(FOREIGN, { reference: 'OTH-7', ...known(true) })]
  assert.deepEqual([...waitingOn(links, items)], [[blocked.work_item_id, 'OTH-7']])
})

test('a finished blocker, here or elsewhere, holds nothing up', () => {
  const links = [
    block(FOREIGN, { reference: 'OTH-7', ...known(false) }),
    block(doneHere.work_item_id, { reference: doneHere.reference, ...known(false) }),
  ]
  assert.equal(waitingOn(links, items).size, 0)
})

test('the link’s word on its source stands over the item the view holds', () => {
  // The view's read model names the source's state; the brief may be older.
  const links = [block(openHere.work_item_id, { reference: openHere.reference, ...known(false) })]
  assert.equal(waitingOn(links, items).size, 0)
})

test('a state the store could not resolve is not taken for an open blocker', () => {
  const links = [
    block(FOREIGN, {
      reference: 'OTH-7',
      state_name: null,
      state_category: null,
      is_terminal: null,
      state_unavailable: 'state_missing',
    }),
  ]
  assert.equal(waitingOn(links, items).size, 0)
})

test('a link that names no state has its source looked up among the items', () => {
  assert.deepEqual(
    [...waitingOn([block(openHere.work_item_id)], items)],
    [[blocked.work_item_id, 'MAIN-2']],
  )
  assert.equal(waitingOn([block(doneHere.work_item_id)], items).size, 0)
  // Nothing said about a source nobody holds: it is not assumed open.
  assert.equal(waitingOn([block(FOREIGN)], items).size, 0)
})

test('only a block makes an item wait, and the first open one is the one named', () => {
  const links: PlanningEdge[] = [
    { from: openHere.work_item_id, to: blocked.work_item_id, kind: 'relates-to' },
    block(doneHere.work_item_id),
    block(FOREIGN, { reference: 'OTH-7', ...known(true) }),
    block(openHere.work_item_id),
  ]
  assert.deepEqual([...waitingOn(links, items)], [[blocked.work_item_id, 'OTH-7']])
  assert.equal(waitingOn(links, items).has(boardId(2)), false)
})

test('the read model takes a link that names its source and refuses one that half says it', () => {
  const model = structuredClone(planningReadModel)
  model.links = [block(FOREIGN, { reference: 'OTH-7', ...known(true) })]
  assert.deepEqual(validateReadModel(model).links, model.links)
  model.links = [
    block(FOREIGN, {
      reference: 'OTH-7',
      state_name: null,
      state_category: null,
      is_terminal: null,
      state_unavailable: null,
    }),
  ]
  assert.throws(() => validateReadModel(model))
})
