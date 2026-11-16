/**
 * Two whole spaces as the graph receives them, shaped like the spaces the graph
 * of frames was designed against, with invented names and numbers.
 *
 * The broad space has many goals with a little open work each: 1397 items, 352
 * open, of which 311 are work rather than grouping. 165 items group others —
 * 164 goals and one task that grew children — 41 of them open, 38 of those with
 * open work under them, and 4 closed goals still holding open work. 158 open
 * items are filed under no goal. The largest goal holds 54 items, 21 of them
 * open; one other holds 13 open, among them an item whose only link is to that
 * goal. One goal stands inside another, which the space it imitates did not
 * have, so the frame inside a frame is drawn by something real.
 *
 * The deep space has one goal that dwarfs the rest: 1120 items, 175 open, 25
 * goals of which 8 are open and all 8 hold open work, one of them 273 items with
 * 100 open, and 46 open items under no goal.
 *
 * The links follow the same shape: in the broad space 360 discovered-from, 177
 * blocks and 106 relates-to, of which 87 touch a goal — 5 from open work to its
 * own goal, 28 between open work and another goal — and 2 reach another space.
 *
 * Built rather than written out, from a fixed seed, so the counts above are
 * arithmetic a test can check and the same input arrives on every run.
 */
import type { LiveWork } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { PlanningEdge, PlanningReadModel, WorkItemBrief } from '@/shared/api/planningModel.ts'

type LinkKind = Exclude<PlanningEdge['kind'], 'parent'>
type StateKey = keyof typeof STATES

const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const STATES = {
  backlog: { name: 'Backlog', category: 'triage', is_terminal: false },
  todo: { name: 'Todo', category: 'ready', is_terminal: false },
  dev: { name: 'Dev', category: 'active', is_terminal: false },
  review: { name: 'Review', category: 'review', is_terminal: false },
  blocked: { name: 'Blocked', category: 'blocked', is_terminal: false },
  done: { name: 'Done', category: 'completed', is_terminal: true },
} as const

const STATE_KEYS = Object.keys(STATES) as StateKey[]
const stateId = (key: StateKey) => identity(900 + STATE_KEYS.indexOf(key))

function state(key: StateKey): NonNullable<WorkItemBrief['state']> {
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
  kind?: 'goal' | 'stage'
  /** Holds the item whose one link is to this frame's goal. */
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
    foreignGoal: number
    goalOther: number
    openClosed: number
    openOpen: number
    ownGoal: number
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
  goals: WorkItemBrief[]
  items: WorkItemBrief[]
  links: PlanningEdge[]
  /** The item whose only link is to its own goal, and that goal. */
  lone: { goal: WorkItemBrief; item: WorkItemBrief } | null
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
      open: !closed,
      container_state: null,
      acceptance: null,
      started_at: null,
      waits_for: [],
      workable: false,
      withheld: ['not_ready'],
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
    item.workable =
      item.claim_ref === '' && ['ready', 'triage'].includes(item.state?.category ?? '')
    item.withheld = item.workable ? [] : ['not_ready']
  }
}

function build(plan: ShapePlan): Built {
  const next = random(plan.seed)
  const make = maker(plan)
  const goals: WorkItemBrief[] = []
  for (const frame of plan.frames) {
    const parent = frame.parent === undefined ? null : goals[frame.parent].work_item_id
    const title = frame.title ?? 'Synthetic stream #'
    const kind = frame.kind ?? (parent === null ? 'goal' : 'stage')
    goals.push(make(frame.open ? 'dev' : 'done', parent, kind, title))
  }
  const openWork: WorkItemBrief[] = []
  const work: WorkItemBrief[] = []
  for (const [index, frame] of plan.frames.entries()) {
    const id = goals[index].work_item_id
    openWork.push(...times(frame.openWork, () => make('todo', id, 'task', 'Open piece #')))
    work.push(...times(frame.closedWork, () => make('done', id, 'task', 'Finished piece #')))
  }
  openWork.push(...times(plan.loose.open, () => make('todo', null, 'task', 'Loose piece #')))
  work.push(...times(plan.loose.closed, () => make('done', null, 'task', 'Loose finished piece #')))
  hold(plan, openWork, next)

  const items = [...goals, ...openWork, ...work].sort((left, right) => left.number - right.number)
  const loneAt = plan.frames.findIndex((frame) => frame.lone)
  const loneGoal = goals[loneAt] as WorkItemBrief | undefined
  const loneItem = openWork.find((item) => item.parent_id === loneGoal?.work_item_id)
  const lone = loneGoal && loneItem ? { goal: loneGoal, item: loneItem } : null
  return {
    goals,
    items,
    lone,
    links: wire(plan, { goals, items, loneItem: loneItem ?? null, next }),
  }
}

/** The goal an item stands in, and each goal that one stands in. */
function ancestors(item: WorkItemBrief, byId: Map<string, WorkItemBrief>): Set<string> {
  const found = new Set<string>()
  for (let at = item.parent_id; at !== null && !found.has(at); at = byId.get(at)?.parent_id ?? null)
    found.add(at)
  return found
}

function wire(
  plan: ShapePlan,
  built: {
    goals: WorkItemBrief[]
    items: WorkItemBrief[]
    loneItem: WorkItemBrief | null
    next: () => number
  },
): PlanningEdge[] {
  const { goals, items, loneItem, next } = built
  const byId = new Map(items.map((item) => [item.work_item_id, item]))
  const isWork = (item: WorkItemBrief) => !WORK_ITEM_TREE.isContainer(item) && item !== loneItem
  const open = items.filter((item) => isWork(item) && item.open)
  const closed = items.filter((item) => isWork(item) && !item.open)
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
    const goal = byId.get(loneItem.parent_id)
    if (goal) add(1, () => [loneItem, goal], 'discovered-from')
  }
  add(
    plan.links.ownGoal - (loneItem ? 1 : 0),
    () => {
      const item = pick(filed)
      return [item, byId.get(item.parent_id ?? '') ?? item]
    },
    'discovered-from',
  )
  add(plan.links.foreignGoal, () => {
    const item = pick(open)
    const goal = pick(goals)
    return ancestors(item, byId).has(goal.work_item_id) ? null : flip([item, goal])
  })
  add(plan.links.goalOther, () => flip([pick(goals), next() < 0.7 ? pick(closed) : pick(goals)]))
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
      state_name: source?.state?.name ?? 'Todo',
      state_category: source?.state?.category ?? 'ready',
      is_terminal: source?.state?.is_terminal ?? false,
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
  const open = built.items.filter((item) => item.open)
  return {
    interface_version: 'valkama-planning-read-model',
    planning_spaces: [
      {
        ...space,
        work_items: built.items.length,
        open: open.length,
        active: open.filter((item) => item.state?.category === 'active').length,
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
    { open: true, openWork: 3, closedWork: 2, title: 'A stream of three open pieces #' },
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
  links: { ownGoal: 5, foreignGoal: 28, goalOther: 54, openOpen: 67, openClosed: 62 },
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
  links: { ownGoal: 3, foreignGoal: 15, goalOther: 22, openOpen: 60, openClosed: 100 },
}

export interface GraphSpace {
  /** The grouping items, in the order the space was built: the largest first. */
  goals: WorkItemBrief[]
  lone: { goal: WorkItemBrief; item: WorkItemBrief } | null
  model: PlanningReadModel
}

function space(plan: ShapePlan): GraphSpace {
  const built = build(plan)
  return { goals: built.goals, lone: built.lone, model: readModel(plan, built) }
}

/** Many goals with a little open work each; see the module comment for its counts. */
export const broadSpace = (): GraphSpace => space(BROAD)

/** One goal far larger than the rest; see the module comment for its counts. */
export const deepSpace = (): GraphSpace => space(DEEP)

/**
 * What the server's `live_work` would say for a space: each item a live session
 * holds is working, held, waiting or quiet in turn, so all four are on the field,
 * and every other waiting one asks a person, so every sign a card draws is there.
 */
export function liveWorkFor(model: PlanningReadModel): Record<string, LiveWork> {
  const live = model.work_items.filter((item) => item.claim_state === 'live')
  return Object.fromEntries(
    live.map((item, index): [string, LiveWork] => [
      item.work_item_id,
      [
        { state: 'working' } as const,
        { state: 'held' } as const,
        { state: 'waiting', long: false, asks: index % 8 === 6 } as const,
        { state: 'quiet', quiet_since: '2026-11-02T08:00:00Z' } as const,
      ][index % 4],
    ]),
  )
}
