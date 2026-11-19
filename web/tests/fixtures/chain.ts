/**
 * A chain shaped like the one that started this view: MAIN-384, a goal closed
 * with all 273 children done, and 343 more items discovered from them — 242
 * under MAIN-779, 88 under no goal, 13 under MAIN-900. 133 of the 616 are open:
 * 11 in progress, 1 in review, 14 ready and 107 untriaged, of which the
 * space calls 115 workable.
 *
 * Built rather than written out, so the counts are arithmetic a reader can
 * check against the numbers above instead of a 600-row literal.
 */
import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'

const CHAIN_ROOT_ID = '00000000-0000-4000-8000-000000000384'

const STATES = {
  done: { key: 'done', name: 'Done', category: 'completed', is_terminal: true },
  active: { key: 'dev', name: 'Development', category: 'active', is_terminal: false },
  review: { key: 'review', name: 'Code review', category: 'review', is_terminal: false },
  ready: { key: 'ready', name: 'Ready', category: 'ready', is_terminal: false },
  triage: { key: 'triage', name: 'Triage', category: 'triage', is_terminal: false },
} as const

type StateName = keyof typeof STATES

function chainId(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
}

let next = 1000

function member(state: StateName, parent: string | null, workable = false, claim = '') {
  const number = next++
  const terminal = STATES[state].is_terminal
  return {
    work_item_id: chainId(number),
    reference: `MAIN-${number}`,
    title: `Chain item ${number}`,
    kind: 'task' as const,
    state: { ...STATES[state] },
    open: !terminal,
    container_state: null,
    claim_ref: claim,
    claim_state: claim ? ('live' as const) : null,
    parent_reference: parent,
    created_at: '2026-10-20T10:00:00Z',
    closed_at: terminal ? '2026-10-29T10:00:00Z' : null,
    workable,
    // A workable member's place in the queue follows its number here.
    queue_order: workable ? number : null,
  }
}

function many(count: number, make: (index: number) => ReturnType<typeof member>) {
  return Array.from({ length: count }, (_, index) => make(index))
}

export function largeGoalChain() {
  next = 1000
  const members = [
    ...many(273, () => member('done', 'MAIN-384')),
    ...many(11, () => member('active', 'MAIN-779', false, 'codex (session 1baa03d7)')),
    ...many(1, () => member('review', 'MAIN-779', false, 'claude')),
    ...many(14, () => member('ready', 'MAIN-779', true)),
    ...many(74, (index) => member('triage', 'MAIN-779', index < 71)),
    ...many(142, () => member('done', 'MAIN-779')),
    ...many(30, () => member('triage', null, true)),
    ...many(58, () => member('done', null)),
    ...many(3, () => member('triage', 'MAIN-900')),
    ...many(10, () => member('done', 'MAIN-900')),
  ]
  return {
    root: {
      work_item_id: CHAIN_ROOT_ID,
      reference: 'MAIN-384',
      title: 'Planning rethink',
      kind: 'goal' as const,
      has_children: true,
      totals: { chain: 616, tree: 273 },
    },
    scope: 'chain' as const,
    total: 616,
    closed: 483,
    open: 133,
    workable: 115,
    by_category: { active: 11, completed: 483, ready: 14, review: 1, triage: 107 },
    by_container_state: {},
    by_project: [],
    origins: [
      { parent_reference: 'MAIN-384', parent_title: 'Planning rethink', count: 273, open: 0 },
      { parent_reference: 'MAIN-779', parent_title: 'Second wave', count: 242, open: 100 },
      { parent_reference: null, parent_title: null, count: 88, open: 30 },
      { parent_reference: 'MAIN-900', parent_title: 'Follow-ups', count: 13, open: 3 },
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

/** The same goal read as its contents, scope `tree`: its own 273 children, all done. */
export function largeGoalContents() {
  const whole = largeGoalChain()
  return {
    ...whole,
    scope: 'tree' as const,
    members: whole.members.filter((member) => member.parent_reference === 'MAIN-384'),
    total: 273,
    closed: 273,
    open: 0,
    workable: 0,
    by_category: { completed: 273 },
    origins: whole.origins.slice(0, 1),
    edges: [],
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
      totals: { chain: 0, tree: 0 },
    },
    scope: 'chain' as const,
    total: 0,
    closed: 0,
    open: 0,
    workable: 0,
    by_category: {},
    by_container_state: {},
    by_project: [],
    origins: [],
    series: [],
    recent: { days: 7, created: 0, closed: 0, trend: 'steady' as const },
    members: [],
    edges: [],
  }
}

/** The wire envelope every planning read arrives in. */
export function chainResponse(chain: WorkItemChain) {
  return { interface_version: 'valkama-planning-api', chain }
}
