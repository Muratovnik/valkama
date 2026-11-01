/**
 * The branch map's lanes: a chain read as lanes of equal-width units, where
 * each lane is one origin of work and branches off the lane it was discovered
 * from.
 *
 * Sequence runs along x, not time. Every member is one unit, so a lane's length
 * is its volume and its grey tail is what remains; a lane reads finished work
 * by closing time, then what is under way, then what is ahead. A lane starts one
 * unit after the task it was discovered from, which is where the stem from its
 * parent leaves — the shape of a git graph laid on its side.
 *
 * Pure on purpose: what the map claims — this lane forks here, this much of it
 * is done — is easier to check as a function of the chain than through a
 * mounted drawing, and the component only turns these numbers into elements.
 */

import type { ChainMember, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { CHAIN_PROGRESS_ORDER, chainGroup } from '@/shared/api/planningChainGroups.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'

/** The three things a reader asks of a lane: how much is finished, under way, ahead. */
type LaneStage = 'ahead' | 'current' | 'done'

const STAGE: Record<ChainGroup, LaneStage> = {
  done: 'done',
  review: 'current',
  active: 'current',
  blocked: 'ahead',
  queued: 'ahead',
  backlog: 'ahead',
}

/** The source of a fork: a lane and the index of the task in it, -1 for the root itself. */
export interface LaneFork {
  index: number
  lane: string
}

export interface BranchLane {
  counts: Record<LaneStage, number>
  /** Where the lane branched off, or null for a lane drawn from the start. */
  fork: LaneFork | null
  /** Each member's group, in the same order as `members`. */
  groups: ChainGroup[]
  /** The lane's identity: its parent's reference, or the empty string for no epic. */
  key: string
  members: ChainMember[]
  /** The root's own children. */
  own: boolean
  reference: string | null
  /** The first unit the lane occupies on the shared axis. */
  start: number
  title: string | null
}

export interface BranchLayout {
  /** How many units the longest-reaching lane ends at. */
  extent: number
  /** In the order they are drawn, top to bottom. */
  lanes: BranchLane[]
  total: number
}

function referenceNumber(reference: string): number {
  return Number(reference.slice(reference.lastIndexOf('-') + 1))
}

function byAge(left: ChainMember, right: ChainMember): number {
  return (
    left.created_at.localeCompare(right.created_at) ||
    referenceNumber(left.reference) - referenceNumber(right.reference)
  )
}

/** Finished work by when it closed; open work ready first, then oldest first. */
function laneOrder(left: ChainMember, right: ChainMember): number {
  const leftGroup = chainGroup(left)
  const step =
    CHAIN_PROGRESS_ORDER.indexOf(leftGroup) - CHAIN_PROGRESS_ORDER.indexOf(chainGroup(right))
  if (step) return step
  if (leftGroup === 'done')
    return (left.closed_at ?? '').localeCompare(right.closed_at ?? '') || byAge(left, right)
  return Number(right.ready) - Number(left.ready) || byAge(left, right)
}

interface Lane extends BranchLane {
  candidates: LaneFork[]
  children: Lane[]
}

function newLane(chain: WorkItemChain, reference: string | null): Lane {
  const origin = chain.origins.find((entry) => entry.parent_reference === reference)
  const own = reference === chain.root.reference
  const fallbackTitle = own ? chain.root.title : null
  return {
    key: reference ?? '',
    reference,
    title: origin?.parent_title ?? fallbackTitle,
    own,
    members: [],
    groups: [],
    counts: { done: 0, current: 0, ahead: 0 },
    start: 0,
    fork: null,
    candidates: [],
    children: [],
  }
}

/** What fork resolution reads about the whole chain, gathered once. */
interface ForkContext {
  byId: Map<string, ChainMember>
  own: Lane | undefined
  placed: Map<string, { index: number; lane: Lane }>
  rootId: string
  /** For each member, the items it was discovered from. */
  sources: Map<string, string[]>
}

/** A member's discovery sources, the oldest first. */
function sourcesOf(context: ForkContext, id: string): string[] {
  const age = (source: string) => context.byId.get(source)
  return [...(context.sources.get(id) ?? [])].sort((left, right) => {
    const a = age(left)
    const b = age(right)
    // The root is not a member, and it is older than any member it led to.
    return a && b ? byAge(a, b) : Number(Boolean(a)) - Number(Boolean(b))
  })
}

/**
 * Where a lane may fork from, best first: where its own epic was discovered,
 * when that epic is in the chain; then where each of its members was, earliest
 * member first; then the epic's own place in its lane.
 */
function forkCandidates(lane: Lane, context: ForkContext): LaneFork[] {
  const candidates: LaneFork[] = []
  const add = (source: string) => {
    if (source === context.rootId) {
      if (context.own && context.own !== lane) candidates.push({ lane: context.own.key, index: -1 })
      return
    }
    const at = context.placed.get(source)
    if (at && at.lane !== lane) candidates.push({ lane: at.lane.key, index: at.index })
  }
  const epic = lane.reference === null ? undefined : findMember(context, lane.reference)
  const discovered = [...(epic ? [epic] : []), ...[...lane.members].sort(byAge)]
  for (const member of discovered)
    for (const source of sourcesOf(context, member.work_item_id)) add(source)
  const home = epic && context.placed.get(epic.work_item_id)
  if (home && home.lane !== lane) candidates.push({ lane: home.lane.key, index: home.index })
  return candidates
}

function findMember(context: ForkContext, reference: string): ChainMember | undefined {
  for (const member of context.byId.values()) if (member.reference === reference) return member
  return undefined
}

/**
 * Hang every lane on the lane its best fork names, as long as that keeps the
 * whole a tree. A lane whose best source is not yet attached waits for it; when
 * nothing can move, discovery has a cycle, and the first lane with any attached
 * source takes it, which breaks the cycle with the least change. When no lane
 * has one, one lane stands from the start — the one `standsFirst` prefers — and
 * the rest still hang on it, so a cycle never turns into a set of loose lanes.
 */
function attach(lanes: Lane[], roots: Lane[], standsFirst: (lane: Lane) => boolean) {
  const attached = new Set<string>(roots.map((lane) => lane.key))
  const byKey = new Map(lanes.map((lane) => [lane.key, lane]))
  const waiting = lanes.filter((lane) => !attached.has(lane.key))
  const reachable = (fork: LaneFork) => attached.has(fork.lane)
  const settle = (lane: Lane, fork: LaneFork | null) => {
    lane.fork = fork
    if (fork) byKey.get(fork.lane)?.children.push(lane)
    else roots.push(lane)
    attached.add(lane.key)
    waiting.splice(waiting.indexOf(lane), 1)
  }
  while (waiting.length) {
    const ready = waiting.filter((lane) => lane.candidates[0] && reachable(lane.candidates[0]))
    for (const lane of ready) settle(lane, lane.candidates[0])
    if (ready.length) continue
    const fallback = waiting.find((lane) =>
      lane.candidates.some((candidate) => reachable(candidate)),
    )
    if (fallback)
      settle(fallback, fallback.candidates.find((candidate) => reachable(candidate)) ?? null)
    else settle(waiting.find((lane) => standsFirst(lane)) ?? waiting[0], null)
  }
}

/**
 * Rows top to bottom: each lane, then its branches, the one forking furthest
 * along first. A branch that forks earlier then stands further down, and its
 * stem passes rows whose lanes have not started yet instead of crossing one.
 */
function placeRows(lane: Lane, rows: Lane[]) {
  rows.push(lane)
  for (const child of lane.children) {
    const index = child.fork?.index ?? -1
    child.start = lane.start + Math.max(0, index + 1)
  }
  const children = [...lane.children].sort(
    (left, right) => right.start - left.start || right.members.length - left.members.length,
  )
  for (const child of children) placeRows(child, rows)
}

/** One lane per parent the chain's members live under, in the answer's origin order. */
function collectLanes(chain: WorkItemChain): Lane[] {
  const lanes = new Map<string, Lane>()
  for (const origin of chain.origins)
    lanes.set(origin.parent_reference ?? '', newLane(chain, origin.parent_reference))
  for (const member of chain.members) {
    const key = member.parent_reference ?? ''
    let lane = lanes.get(key)
    if (!lane) {
      lane = newLane(chain, member.parent_reference)
      lanes.set(key, lane)
    }
    lane.members.push(member)
  }
  const present = [...lanes.values()].filter((lane) => lane.members.length > 0)
  for (const lane of present) {
    lane.members.sort(laneOrder)
    lane.groups = lane.members.map((member) => chainGroup(member))
    for (const group of lane.groups) lane.counts[STAGE[group]] += 1
  }
  return present
}

function forkContext(chain: WorkItemChain, lanes: Lane[]): ForkContext {
  const placed: ForkContext['placed'] = new Map()
  for (const lane of lanes)
    for (const [index, member] of lane.members.entries())
      placed.set(member.work_item_id, { lane, index })
  const sources = new Map<string, string[]>()
  for (const edge of chain.edges)
    if (edge.kind === 'discovered-from')
      sources.set(edge.from, [...(sources.get(edge.from) ?? []), edge.to])
  return {
    byId: new Map(chain.members.map((member) => [member.work_item_id, member])),
    own: lanes.find((lane) => lane.own),
    placed,
    rootId: chain.root.work_item_id,
    sources,
  }
}

export function layoutBranches(chain: WorkItemChain): BranchLayout {
  const present = collectLanes(chain)
  const context = forkContext(chain, present)
  const { own } = context
  for (const lane of present) if (lane !== own) lane.candidates = forkCandidates(lane, context)

  // Without the root's own lane, a lane found only from the root itself has no
  // fork to draw and stands from the start, like the root's lane would. When
  // every lane names another, none stands alone here, and `attach` starts from
  // the one holding work found from the root rather than from all of them.
  const fromRoot = (lane: Lane) =>
    lane.members.some((member) =>
      context.sources.get(member.work_item_id)?.includes(context.rootId),
    )
  const roots = own ? [own] : present.filter((lane) => lane.candidates.length === 0)
  attach(present, roots, fromRoot)

  const rows: Lane[] = []
  for (const root of roots) placeRows(root, rows)
  const extent = Math.max(0, ...rows.map((lane) => lane.start + lane.members.length))
  return {
    lanes: rows.map(({ candidates: _candidates, children: _children, ...lane }) => lane),
    extent,
    total: chain.members.length,
  }
}

/** A stretch of one lane in one group, by member index, end exclusive. */
interface BranchRun {
  from: number
  group: ChainGroup
  to: number
}

/**
 * The lane as stretches to draw. Merged, consecutive members of one group are
 * one stretch, which is what a lane of a few hundred one-pixel units needs;
 * unmerged, every member is its own.
 */
export function laneRuns(lane: BranchLane, merge: boolean): BranchRun[] {
  const runs: BranchRun[] = []
  for (const [index, group] of lane.groups.entries()) {
    const last = runs.at(-1)
    if (merge && last?.group === group) last.to = index + 1
    else runs.push({ group, from: index, to: index + 1 })
  }
  return runs
}
