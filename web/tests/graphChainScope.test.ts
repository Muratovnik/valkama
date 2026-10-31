import assert from 'node:assert/strict'

import ELK from 'elkjs/lib/elk.bundled.js'
import { test } from 'vitest'

import { layout, unlinkedIds, workNodes } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphScope, GraphSource } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import { chainGroup } from '@/shared/api/planningChainGroups.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

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
    reference: `VAL-${n}`,
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

test('chain scope keeps exactly the root and the members, the root and closed work included', () => {
  const drawn = workNodes(space, false, chain).map((node) => node.reference)
  assert.deepEqual(drawn, ['VAL-1', 'VAL-2', 'VAL-3', 'VAL-4'])
  // The whole space never draws the root (it is a container) nor, by default, done work.
  assert.deepEqual(
    workNodes(space, false).map((node) => node.reference),
    ['VAL-3', 'VAL-4', 'VAL-5', 'VAL-6'],
  )
})

test('the chain is laid out with only its own nodes, and a link to outside work is dropped', async () => {
  const placed = await layout(
    { nodes: space.nodes, edges: [{ from: id(4), to: id(2), kind: 'discovered-from' }] },
    new ELK(),
    false,
    chain,
  )
  assert.deepEqual(
    placed.nodes.map((node) => node.reference).sort((left, right) => left.localeCompare(right)),
    ['VAL-1', 'VAL-2', 'VAL-3', 'VAL-4'],
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
