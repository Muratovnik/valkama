import assert from 'node:assert/strict'

import ELK from 'elkjs/lib/elk.bundled.js'
import { test } from 'vitest'

import {
  doneCount,
  layout,
  unlinkedIds,
  workNodes,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphScope, GraphSource } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import { chainGroup } from '@/shared/api/planningChainGroups.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { longChainSpace } from './fixtures/chainSpace.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const OPEN = {
  state_id: id(900),
  key: 'todo',
  name: 'Todo',
  category: 'queued',
  is_terminal: false,
}
const DONE = {
  state_id: id(901),
  key: 'done',
  name: 'Done',
  category: 'completed',
  is_terminal: true,
}

function item(n: number, overrides: Partial<WorkItemBrief> = {}): WorkItemBrief {
  return {
    work_item_id: id(n),
    planning_space_id: id(800),
    reference: `MAIN-${n}`,
    number: n,
    title: `item ${n}`,
    kind: 'task',
    priority: 'medium',
    state: OPEN,
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    labels: [],
    source: '',
    checklist: [],
    revision: 0,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    container: false,
    ready: false,
    comment_count: 0,
    ...overrides,
  } as WorkItemBrief
}

// A space: an epic root (1) with a closed child (2) and an open child (3); an
// item discovered from the child (4) filed under no epic; and two items (5, 6)
// outside the chain, one of them linked to the chain.
const root = item(1, { kind: 'epic', container: true })
const space: GraphSource = {
  nodes: [
    root,
    item(2, { parent_id: id(1), state: DONE }),
    item(3, { parent_id: id(1) }),
    item(4),
    item(5),
    item(6),
  ],
  edges: [
    { from: id(4), to: id(2), kind: 'discovered-from' },
    { from: id(5), to: id(3), kind: 'blocks' },
    { from: id(3), to: id(1), kind: 'parent' },
  ],
}
const chain: GraphScope = { kind: 'chain', epicId: id(1), members: [id(2), id(3), id(4)] }

test('chain scope draws its open part by default and every member when closed work is asked for', () => {
  // 2 is closed and the parent of nothing drawn, so the default leaves it out.
  const drawn = workNodes(space, false, chain).map((node) => node.reference)
  assert.deepEqual(drawn, ['MAIN-1', 'MAIN-3', 'MAIN-4'])
  assert.deepEqual(
    workNodes(space, true, chain).map((node) => node.reference),
    ['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4'],
  )
  assert.equal(doneCount(space, chain), 1)
  // The whole space never draws the root (it is a container) nor, by default, done work.
  assert.deepEqual(
    workNodes(space, false).map((node) => node.reference),
    ['MAIN-3', 'MAIN-4', 'MAIN-5', 'MAIN-6'],
  )
})

test('the chain is laid out with only its own nodes, and a link to outside work is dropped', async () => {
  const placed = await layout(
    { nodes: space.nodes, edges: [{ from: id(4), to: id(2), kind: 'discovered-from' }] },
    new ELK(),
    true,
    chain,
  )
  assert.deepEqual(
    placed.nodes.map((node) => node.reference).sort((left, right) => left.localeCompare(right)),
    ['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4'],
  )
  assert.equal(placed.edges.length, 1)
})

test('an item no drawn link touches is unlinked, and a parent edge is not a link', () => {
  // Open view: 3 and 5 are linked by a block; 4's only link is to closed 2.
  assert.deepEqual(
    [...unlinkedIds(space, false)].sort((left, right) => left.localeCompare(right)),
    [id(4), id(6)],
  )
  // All view: 4 is linked to 2, so only 6 is left.
  assert.deepEqual([...unlinkedIds(space, true)], [id(6)])
})

test('when nothing in view is linked, nothing is called unlinked and every item is drawn', () => {
  const loose: GraphSource = { nodes: [item(7), item(8)], edges: [] }
  assert.equal(unlinkedIds(loose, false).size, 0)
})

/** The group of an item in this category, ready to take or not. */
function at(category: string, terminal = false, ready = false) {
  const member = { ready, state: { category, is_terminal: terminal } }
  return chainGroup(member)
}

test('a chain member is grouped by its workflow category, never by readiness', () => {
  assert.equal(at('backlog', false, true), 'backlog')
  assert.equal(at('queued', false, true), 'queued')
  assert.equal(at('active'), 'active')
  assert.equal(at('review'), 'review')
  assert.equal(at('blocked'), 'blocked')
  assert.equal(at('completed', true), 'done')
  assert.equal(at('cancelled', true), 'done')
})

test('a long chain draws the root, its open work and every epic its work is filed under', () => {
  const { source, scope, root, openEpic, closedEpic, doneEpic } = longChainSpace()
  const all = workNodes(source, true, scope)
  // The whole chain: the root and its 609 members, the linked outsider left out;
  // the 489 closed members and the closed root.
  assert.equal(all.length, 610)
  assert.equal(all.filter((node) => node.state.is_terminal).length, 490)

  const drawn = workNodes(source, false, scope)
  const ids = new Set(drawn.map((node) => node.work_item_id))
  // The 120 open members, the closed root, the closed epic three of them are
  // still filed under, and the epic that closed with all of its work: an origin
  // of the chain is drawn whether or not anything under it is still open.
  // Nothing else that is closed.
  assert.equal(drawn.length, 123)
  assert.ok(ids.has(root.work_item_id))
  assert.ok(ids.has(openEpic.work_item_id))
  assert.ok(ids.has(closedEpic.work_item_id))
  assert.ok(ids.has(doneEpic.work_item_id))
  assert.deepEqual(
    drawn
      .filter((node) => node.state.is_terminal)
      .map((node) => node.reference)
      .sort((left, right) => left.localeCompare(right)),
    [closedEpic.reference, doneEpic.reference, root.reference].sort((left, right) =>
      left.localeCompare(right),
    ),
  )
  // What the switch promises is exactly what it adds: 610 drawn with it, 123 without.
  assert.equal(doneCount(source, scope), all.length - drawn.length)
  assert.equal(doneCount(source, scope), 487)
})

test('a closed parent outside the chain does not come back with its open child', () => {
  const outsider = item(20, { kind: 'epic', container: true, state: DONE })
  const child = item(21, { parent_id: id(20) })
  const nodes = { nodes: [root, outsider, child], edges: [] }
  const scope: GraphScope = { kind: 'chain', epicId: id(1), members: [id(21)] }
  assert.deepEqual(
    workNodes(nodes, false, scope).map((node) => node.reference),
    ['MAIN-1', 'MAIN-21'],
  )
})
