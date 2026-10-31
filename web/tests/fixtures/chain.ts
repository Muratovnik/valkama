/**
 * A chain shaped like the one that started this view: VAL-384, an epic closed
 * with all 273 children done, and 343 more items discovered from them — 242
 * under VAL-779, 88 under no epic, 13 under VAL-900. 133 of the 616 are open:
 * 11 in progress, 1 in review, 14 queued and 107 in the backlog, of which the
 * space calls 115 workable.
 *
 * Built rather than written out, so the counts are arithmetic a reader can
 * check against the numbers above instead of a 600-row literal.
 */

const CHAIN_ROOT_ID = '00000000-0000-4000-8000-000000000384'

const STATES = {
  done: { key: 'done', name: 'Done', category: 'completed', is_terminal: true },
  active: { key: 'dev', name: 'Development', category: 'active', is_terminal: false },
  review: { key: 'review', name: 'Code review', category: 'review', is_terminal: false },
  queued: { key: 'todo', name: 'Todo', category: 'queued', is_terminal: false },
  backlog: { key: 'backlog', name: 'Backlog', category: 'backlog', is_terminal: false },
} as const

type StateName = keyof typeof STATES

function chainId(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
}

let next = 1000

function member(state: StateName, parent: string | null, ready = false, claim = '') {
  const number = next++
  const terminal = STATES[state].is_terminal
  return {
    work_item_id: chainId(number),
    reference: `VAL-${number}`,
    title: `Chain item ${number}`,
    state: { ...STATES[state] },
    claim_ref: claim,
    claim_state: claim ? ('live' as const) : null,
    parent_reference: parent,
    created_at: '2026-10-20T10:00:00Z',
    closed_at: terminal ? '2026-10-29T10:00:00Z' : null,
    ready,
    // The order of work follows the numbers here, so a group read by rank reads
    // the way it did by reference.
    rank: number,
  }
}

function many(count: number, make: (index: number) => ReturnType<typeof member>) {
  return Array.from({ length: count }, (_, index) => make(index))
}

export function largeEpicChain() {
  next = 1000
  const members = [
    ...many(273, () => member('done', 'VAL-384')),
    ...many(11, () => member('active', 'VAL-779', false, 'codex (session 1baa03d7)')),
    ...many(1, () => member('review', 'VAL-779', false, 'claude')),
    ...many(14, () => member('queued', 'VAL-779', true)),
    ...many(74, (index) => member('backlog', 'VAL-779', index < 71)),
    ...many(142, () => member('done', 'VAL-779')),
    ...many(30, () => member('backlog', null, true)),
    ...many(58, () => member('done', null)),
    ...many(3, () => member('backlog', 'VAL-900')),
    ...many(10, () => member('done', 'VAL-900')),
  ]
  return {
    root: {
      work_item_id: CHAIN_ROOT_ID,
      reference: 'VAL-384',
      title: 'Planning rethink',
      kind: 'epic' as const,
      has_children: true,
    },
    scope: 'chain' as const,
    total: 616,
    closed: 483,
    open: 133,
    ready: 115,
    by_category: { active: 11, backlog: 107, completed: 483, queued: 14, review: 1 },
    origins: [
      { parent_reference: 'VAL-384', parent_title: 'Planning rethink', count: 273, open: 0 },
      { parent_reference: 'VAL-779', parent_title: 'Second wave', count: 242, open: 100 },
      { parent_reference: null, parent_title: null, count: 88, open: 30 },
      { parent_reference: 'VAL-900', parent_title: 'Follow-ups', count: 13, open: 3 },
    ],
    series: [
      { day: '2026-09-01', created: 273, closed: 0, total: 273, closed_total: 0 },
      { day: '2026-09-20', created: 150, closed: 200, total: 423, closed_total: 200 },
      { day: '2026-10-15', created: 140, closed: 241, total: 563, closed_total: 441 },
      { day: '2026-10-31', created: 53, closed: 42, total: 616, closed_total: 483 },
    ],
    recent: { days: 7, created: 53, closed: 42, trend: 'growing' as const },
    members,
    edges: [
      { from: members[300].work_item_id, to: members[0].work_item_id, kind: 'discovered-from' },
      { from: members[301].work_item_id, to: members[300].work_item_id, kind: 'blocks' },
    ] as { from: string; kind: 'blocks' | 'discovered-from'; to: string }[],
  }
}

/** The answer for an item nothing was discovered from and that has no children. */
export function emptyChain(reference = 'QA-320', id = '00000000-0000-4000-8000-000000000320') {
  return {
    root: {
      work_item_id: id,
      reference,
      title: 'Leaf',
      kind: 'task' as const,
      has_children: false,
    },
    scope: 'chain' as const,
    total: 0,
    closed: 0,
    open: 0,
    ready: 0,
    by_category: {},
    origins: [],
    series: [],
    recent: { days: 7, created: 0, closed: 0, trend: 'steady' as const },
    members: [],
    edges: [],
  }
}

/** The wire envelope every planning read arrives in. */
export function chainResponse(
  chain: ReturnType<typeof largeEpicChain> | ReturnType<typeof emptyChain>,
) {
  return { interface_version: 'valkama-planning-api', chain }
}
