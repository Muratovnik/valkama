/**
 * Two whole spaces as the graph receives them, shaped like the spaces the graph
 * of frames was designed against, with invented names and numbers.
 *
 * The broad space has many epics with a little open work each: 1397 items, 352
 * open, of which 311 are work rather than grouping. 165 items group others —
 * 164 epics and one task that grew children — 41 of them open, 38 of those with
 * open work under them, and 4 closed epics still holding open work. 158 open
 * items are filed under no epic. The largest epic holds 54 items, 21 of them
 * open; one other holds 13 open, among them an item whose only link is to that
 * epic. One epic stands inside another, which the space it imitates did not
 * have, so the frame inside a frame is drawn by something real.
 *
 * The deep space has one epic that dwarfs the rest: 1120 items, 175 open, 25
 * epics of which 8 are open and all 8 hold open work, one of them 273 items with
 * 100 open, and 46 open items under no epic.
 *
 * The links follow the same shape: in the broad space 360 discovered-from, 177
 * blocks and 106 relates-to, of which 87 touch an epic — 5 from open work to its
 * own epic, 28 between open work and another epic — and 2 reach another space.
 *
 * Built rather than written out, from a fixed seed, so the counts above are
 * arithmetic a test can check and the same input arrives on every run.
 */
import type { LiveWork } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { PlanningEdge, PlanningReadModel, WorkItemBrief } from '@/shared/api/planningModel.ts'

type LinkKind = Exclude<PlanningEdge['kind'], 'parent'>
type StateKey = keyof typeof STATES

const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const STATES = {
  backlog: { name: 'Backlog', category: 'backlog', is_terminal: false },
  todo: { name: 'Todo', category: 'queued', is_terminal: false },
  dev: { name: 'Dev', category: 'active', is_terminal: false },
  review: { name: 'Review', category: 'review', is_terminal: false },
  blocked: { name: 'Blocked', category: 'blocked', is_terminal: false },
  done: { name: 'Done', category: 'completed', is_terminal: true },
} as const

const STATE_KEYS = Object.keys(STATES) as StateKey[]
const stateId = (key: StateKey) => identity(900 + STATE_KEYS.indexOf(key))

function state(key: StateKey): WorkItemBrief['state'] {
  return { state_id: stateId(key), key, ...STATES[key] }
}

/** The open states unclaimed work rests in, in the order they recur. */
const RESTING: StateKey[] = ['backlog', 'todo', 'todo', 'backlog', 'blocked', 'backlog', 'todo']

/** One frame the space is built with: an item that groups others. */
interface FramePlan {
  closedWork: number
  /** The grouping item is still open. */
  open: boolean
  openWork: number
  kind?: 'epic' | 'task'
  /** Holds the item whose one link is to this frame's epic. */
  lone?: true
  /** The frame, by its index in the plan, this one stands inside. */
  parent?: number
  title?: string
}

interface ShapePlan {
  /** Open work held by a session the server sees alive, and by one it cannot confirm. */
  claims: { live: number; unconfirmed: number }
  frames: FramePlan[]
  key: string
  kinds: Record<LinkKind, number>
  /** How many links of each pattern; every other link is between closed work. */
  links: {
    epicOther: number
    foreignEpic: number
    openClosed: number
    openOpen: number
    ownEpic: number
  }
  loose: { closed: number; open: number }
  name: string
  seed: number
}

/** A small deterministic generator, so a shuffle is the same on every run. */
function random(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value + 0x6d_2b_79_f5) >>> 0
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffled<T>(values: readonly T[], next: () => number): T[] {
  const copy = [...values]
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(next() * (index + 1))
    const held = copy[index]
    copy[index] = copy[other]
    copy[other] = held
  }
  return copy
}

interface Built {
  /** The grouping items, in plan order. */
  epics: WorkItemBrief[]
  items: WorkItemBrief[]
  links: PlanningEdge[]
  /** The item whose only link is to its own epic, and that epic. */
  lone: { epic: WorkItemBrief; item: WorkItemBrief } | null
}

/** Numbers items in the order they are made, as a space does. */
function maker(plan: ShapePlan) {
  let number = 0
  return (
    key: StateKey,
    parent: string | null,
    kind: WorkItemBrief['kind'],
    title: string,
  ): WorkItemBrief => {
    number += 1
    const closed = STATES[key].is_terminal
    return {
      work_item_id: identity(number),
      planning_space_id: identity(800),
      reference: `${plan.key}-${number}`,
      number,
      title: title.replace('#', String(number)),
      kind,
      priority: 'medium',
      state: state(key),
      claim_ref: '',
      claim_state: null,
      parent_id: parent,
      container: false,
      ready: false,
      labels: [],
      source: '',
      checklist: [],
      revision: 0,
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
      closed_at: closed ? '2026-10-20T10:00:00Z' : null,
      comment_count: 0,
    }
  }
}

/** `count` items made by `make`. */
function times(count: number, make: () => WorkItemBrief): WorkItemBrief[] {
  return Array.from({ length: count }, () => make())
}

/** Who holds what, spread over the space rather than its first frames. */
function hold(plan: ShapePlan, openWork: readonly WorkItemBrief[], next: () => number) {
  const { live, unconfirmed } = plan.claims
  for (const [index, item] of shuffled(openWork, next).entries()) {
    if (index < live) {
      Object.assign(item, {
        claim_ref: `agent-${index + 1}`,
        claim_state: 'live',
        state: state('dev'),
      })
    } else if (index < live + unconfirmed) {
      const key = index % 3 === 0 ? 'review' : 'dev'
      Object.assign(item, {
        claim_ref: `person-${index}`,
        claim_state: 'unconfirmed',
        state: state(key),
      })
    } else {
      Object.assign(item, { state: state(RESTING[index % RESTING.length]) })
    }
    item.ready = item.claim_ref === '' && ['backlog', 'queued'].includes(item.state.category)
  }
}

function build(plan: ShapePlan): Built {
  const next = random(plan.seed)
  const make = maker(plan)
  const epics: WorkItemBrief[] = []
  for (const frame of plan.frames) {
    const parent = frame.parent === undefined ? null : epics[frame.parent].work_item_id
    const title = frame.title ?? 'Synthetic stream #'
    epics.push(make(frame.open ? 'dev' : 'done', parent, frame.kind ?? 'epic', title))
  }
  const openWork: WorkItemBrief[] = []
  const work: WorkItemBrief[] = []
  for (const [index, frame] of plan.frames.entries()) {
    const id = epics[index].work_item_id
    openWork.push(...times(frame.openWork, () => make('todo', id, 'task', 'Open piece #')))
    work.push(...times(frame.closedWork, () => make('done', id, 'task', 'Finished piece #')))
  }
  openWork.push(...times(plan.loose.open, () => make('todo', null, 'task', 'Loose piece #')))
  work.push(...times(plan.loose.closed, () => make('done', null, 'task', 'Loose finished piece #')))
  hold(plan, openWork, next)

  const items = [...epics, ...openWork, ...work].sort((left, right) => left.number - right.number)
  const parents = new Set(items.map((item) => item.parent_id))
  for (const item of items) item.container = parents.has(item.work_item_id)
  const loneAt = plan.frames.findIndex((frame) => frame.lone)
  const loneEpic = epics[loneAt] as WorkItemBrief | undefined
  const loneItem = openWork.find((item) => item.parent_id === loneEpic?.work_item_id)
  const lone = loneEpic && loneItem ? { epic: loneEpic, item: loneItem } : null
  return {
    epics,
    items,
    lone,
    links: wire(plan, { epics, items, loneItem: loneItem ?? null, next }),
  }
}

/** The epic an item stands in, and each epic that one stands in. */
function ancestors(item: WorkItemBrief, byId: Map<string, WorkItemBrief>): Set<string> {
  const found = new Set<string>()
  for (let at = item.parent_id; at !== null && !found.has(at); at = byId.get(at)?.parent_id ?? null)
    found.add(at)
  return found
}

function wire(
  plan: ShapePlan,
  built: {
    epics: WorkItemBrief[]
    items: WorkItemBrief[]
    loneItem: WorkItemBrief | null
    next: () => number
  },
): PlanningEdge[] {
  const { epics, items, loneItem, next } = built
  const byId = new Map(items.map((item) => [item.work_item_id, item]))
  const isWork = (item: WorkItemBrief) => !item.container && item !== loneItem
  const open = items.filter((item) => isWork(item) && !item.state.is_terminal)
  const closed = items.filter((item) => isWork(item) && item.state.is_terminal)
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]
  const seen = new Set<string>()
  const pairs: { from: string; to: string; kind?: LinkKind }[] = []
  /** Adds `count` distinct pairs, whichever way round, drawn by `draw`. */
  const add = (
    count: number,
    draw: () => [WorkItemBrief, WorkItemBrief] | null,
    kind?: LinkKind,
  ) => {
    let added = 0
    let tries = 0
    while (added < count) {
      tries += 1
      if (tries > count * 50) throw new Error('the fixture ran out of distinct links')
      const pair = draw()
      if (!pair || pair[0] === pair[1]) continue
      const key = [pair[0].work_item_id, pair[1].work_item_id].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({ from: pair[0].work_item_id, to: pair[1].work_item_id, kind })
      added += 1
    }
  }
  const flip = (pair: [WorkItemBrief, WorkItemBrief]): [WorkItemBrief, WorkItemBrief] =>
    next() < 0.5 ? pair : [pair[1], pair[0]]

  const filed = open.filter((item) => item.parent_id !== null)
  if (loneItem?.parent_id) {
    const epic = byId.get(loneItem.parent_id)
    if (epic) add(1, () => [loneItem, epic], 'discovered-from')
  }
  add(
    plan.links.ownEpic - (loneItem ? 1 : 0),
    () => {
      const item = pick(filed)
      return [item, byId.get(item.parent_id ?? '') ?? item]
    },
    'discovered-from',
  )
  add(plan.links.foreignEpic, () => {
    const item = pick(open)
    const epic = pick(epics)
    return ancestors(item, byId).has(epic.work_item_id) ? null : flip([item, epic])
  })
  add(plan.links.epicOther, () => flip([pick(epics), next() < 0.7 ? pick(closed) : pick(epics)]))
  add(plan.links.openOpen, () => [pick(open), pick(open)])
  add(plan.links.openClosed, () => flip([pick(open), pick(closed)]))
  const total = Object.values(plan.kinds).reduce((sum, count) => sum + count, 0)
  add(total - pairs.length - 2, () => [pick(closed), pick(closed)])

  // Two links reach another space: one leaves it, and one blocks into it.
  const outside = identity(990_001)
  const leaving = pick(open)
  const entering = pick(open)
  pairs.push(
    { from: leaving.work_item_id, to: outside },
    { from: outside, to: entering.work_item_id, kind: 'blocks' },
  )

  // Every pattern takes its kinds from one pool, so the totals are exact.
  const pool = shuffled(
    (Object.entries(plan.kinds) as [LinkKind, number][]).flatMap(([kind, count]) =>
      Array.from({ length: count - pairs.filter((pair) => pair.kind === kind).length }, () => kind),
    ),
    next,
  )
  return pairs.map((pair) => {
    const kind = pair.kind ?? pool.pop()
    if (kind === undefined) throw new Error('the fixture ran out of link kinds')
    const source = byId.get(pair.from)
    return {
      from: pair.from,
      to: pair.to,
      kind,
      reference: source?.reference ?? 'EXT-9',
      state_name: source?.state.name ?? 'Todo',
      state_category: source?.state.category ?? 'queued',
      is_terminal: source?.state.is_terminal ?? false,
      state_unavailable: null,
    }
  })
}

function readModel(plan: ShapePlan, built: Built): PlanningReadModel {
  const space = {
    planning_space_id: identity(800),
    project_id: 'example-project',
    name: plan.name,
    key: plan.key,
    provider_kind: 'local' as const,
  }
  const open = built.items.filter((item) => !item.state.is_terminal)
  return {
    interface_version: 'valkama-planning-read-model',
    planning_spaces: [
      {
        ...space,
        work_items: built.items.length,
        open: open.length,
        active: open.filter((item) => item.state.category === 'active').length,
        completed: built.items.length - open.length,
        updated_at: '2026-10-20T10:00:00Z',
      },
    ],
    planning_space: space,
    workflow: {
      workflow_id: identity(700),
      name: 'Default',
      initial_state_id: stateId('backlog'),
      states: STATE_KEYS.map((key, position) => ({ ...state(key), position })),
      transitions: [],
    },
    work_items: built.items,
    links: built.links,
    stale_claims: [],
  }
}

/** `count` frames that differ only in how much work each holds. */
const frames = (count: number, frame: FramePlan) =>
  Array.from({ length: count }, () => ({ ...frame }))

const BROAD: ShapePlan = {
  key: 'MAIN',
  name: 'Broad space',
  seed: 20_261_104,
  frames: [
    { open: true, openWork: 21, closedWork: 33, title: 'The largest stream #' },
    { open: true, openWork: 13, closedWork: 2, lone: true, title: 'A stream with one lone link #' },
    { open: true, openWork: 3, closedWork: 2, title: 'A stream another stands in #' },
    { open: true, openWork: 3, closedWork: 2, parent: 2, title: 'A stream inside another #' },
    { open: true, openWork: 3, closedWork: 2, kind: 'task', title: 'A task that grew children #' },
    {
      open: true,
      openWork: 2,
      closedWork: 2,
      title: 'A stream whose title runs long enough that no header can hold it on a phone #',
    },
    ...frames(32, { open: true, openWork: 3, closedWork: 2 }),
    ...frames(4, {
      open: false,
      openWork: 3,
      closedWork: 2,
      title: 'A closed stream still holding work #',
    }),
    ...frames(3, {
      open: true,
      openWork: 0,
      closedWork: 3,
      title: 'An open stream with nothing open #',
    }),
    ...frames(17, { open: false, openWork: 0, closedWork: 5 }),
    ...frames(103, { open: false, openWork: 0, closedWork: 4 }),
  ],
  loose: { open: 158, closed: 300 },
  claims: { live: 16, unconfirmed: 78 },
  kinds: { 'discovered-from': 360, 'blocks': 177, 'relates-to': 106, 'duplicates': 0 },
  links: { ownEpic: 5, foreignEpic: 28, epicOther: 54, openOpen: 67, openClosed: 62 },
}

const DEEP: ShapePlan = {
  key: 'OPS',
  name: 'Deep space',
  seed: 11_042_026,
  frames: [
    { open: true, openWork: 100, closedWork: 173, title: 'The stream that dwarfs the rest #' },
    ...frames(7, { open: true, openWork: 3, closedWork: 5 }),
    ...frames(17, { open: false, openWork: 0, closedWork: 20 }),
  ],
  loose: { open: 46, closed: 380 },
  claims: { live: 7, unconfirmed: 0 },
  kinds: { 'discovered-from': 658, 'blocks': 148, 'relates-to': 358, 'duplicates': 11 },
  links: { ownEpic: 3, foreignEpic: 15, epicOther: 22, openOpen: 60, openClosed: 100 },
}

export interface GraphSpace {
  /** The grouping items, in the order the space was built: the largest first. */
  epics: WorkItemBrief[]
  lone: { epic: WorkItemBrief; item: WorkItemBrief } | null
  model: PlanningReadModel
}

function space(plan: ShapePlan): GraphSpace {
  const built = build(plan)
  return { epics: built.epics, lone: built.lone, model: readModel(plan, built) }
}

/** Many epics with a little open work each; see the module comment for its counts. */
export const broadSpace = (): GraphSpace => space(BROAD)

/** One epic far larger than the rest; see the module comment for its counts. */
export const deepSpace = (): GraphSpace => space(DEEP)

/**
 * What the server's `live_work` would say for a space: each item a live session
 * holds is working, waiting or quiet in turn, so all three are on the field.
 */
export function liveWorkFor(model: PlanningReadModel): Record<string, LiveWork> {
  const live = model.work_items.filter((item) => item.claim_state === 'live')
  return Object.fromEntries(
    live.map((item, index): [string, LiveWork] => [
      item.work_item_id,
      index % 4 === 3
        ? { state: 'quiet', quiet_since: '2026-11-02T08:00:00Z' }
        : { state: index % 4 === 2 ? 'waiting' : 'working' },
    ]),
  )
}
