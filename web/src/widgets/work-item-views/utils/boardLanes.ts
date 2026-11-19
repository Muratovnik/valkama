/**
 * The board read in lanes: by goal, by stage or by project, each lane a row of
 * the state columns.
 *
 * By goal, a lane is a root's: a goal, which stands under nothing. Work filed under
 * a stage stands in the lane of the goal the stage is under, however deep, and
 * names that stage on its tile (`stages`); a stage is work of that lane like any
 * other — a tile there while it stands in a column, and the head of no lane. By
 * stage, a lane is the nearest container's, a goal's or a stage's, and every
 * container heads one and stands as no tile. Work under no goal stands in a lane of
 * its own, last of this space's.
 *
 * A card of another space, which names one of this space's projects, has no parent
 * here: its parent is in its own space. By goal and by stage it stands in a lane of
 * that space, after this space's lanes, rather than under no goal, which would say
 * it has none. By project it stands in the lane of the project it names, as any card.
 *
 * By project, a lane is one of the space's projects; a card naming several stands
 * once, in «Several projects», since one card twice on a screen breaks its drag and
 * its focus and the lanes' counts would no longer add up to the scope's; a card
 * naming none stands in «No project». An accepted open goal or stage stands in no
 * column, so it is in no project's lane either.
 *
 * Three sets go in because a lane answers three questions. Which lanes there are
 * and what each counts comes from the board's scope — the space, or the chain it
 * is narrowed to — before any filter, because a lane's counts describe its work
 * and not the filter. Which tiles a lane draws comes from the filtered items. And
 * a container is named from the whole space, because a chain can hold an item
 * whose goal is not itself in the chain.
 */
import { ancestorsOf, WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

export type BoardGrouping = 'goal' | 'none' | 'project' | 'stage'

/** The lane of the work filed under no goal. */
export const NO_PARENT = 'none'
/** The lanes of the work naming several projects, and none. */
const SEVERAL_PROJECTS = 'projects:several'
const NO_PROJECT = 'projects:none'

/** Tiles a lane cell draws before it asks to show the rest. */
const CELL_LIMIT = 3

/**
 * How many tiles a lane cell draws unasked. A terminal cell (Done, Cancelled)
 * draws none: its work is finished, so it is counted and offered instead.
 */
export function drawnInCell(state: { is_terminal: boolean }): number {
  return state.is_terminal ? 0 : CELL_LIMIT
}

/** What heads a lane, which says whose work the row is. */
export type LaneHead =
  /** A goal or a stage; by stage, `path` is the containers over it, the goal first. */
  | { item: WorkItemBrief; kind: 'container'; path: WorkItemBrief[] }
  | { kind: 'no-goal' }
  | { key: string; kind: 'space'; name: string }
  | { id: string; kind: 'project'; name: string }
  | { kind: 'several-projects' }
  | { kind: 'no-project' }

export interface BoardLane {
  closed: number
  /** The goal or stage heading the lane; null for a lane no card heads. */
  goal: WorkItemBrief | null
  head: LaneHead
  /** The container's work item id, or the lane's own word. */
  id: string
  /** The tiles the lane draws, in the order the server listed them. */
  items: WorkItemBrief[]
  open: number
  /** By goal, the stage a tile stands under, by the tile's id, which its second line names. */
  stages: ReadonlyMap<string, WorkItemBrief>
}

/** A project of the space, which a lane by project is. */
export interface SpaceProject {
  display_name: string
  project_id: string
}

interface LaneInput {
  filtered: boolean
  scope: readonly WorkItemBrief[]
  space: readonly WorkItemBrief[]
  visible: readonly WorkItemBrief[]
  /** How the lanes are cut; by goal unless it says. */
  grouping?: Exclude<BoardGrouping, 'none'>
  /** The space's projects, in its order; null where the registry was not read. */
  projects?: readonly SpaceProject[] | null
}

const isContainer = (item: WorkItemBrief) => WORK_ITEM_TREE.isContainer(item)
const spaceLane = (key: string) => `space:${key}`
const projectLane = (id: string) => `project:${id}`

/**
 * The lane an item stands in, null when it heads one itself, or undefined when it
 * stands in none: an accepted open container by project, which has no column.
 */
type LaneOf = (item: WorkItemBrief) => string | null | undefined

/** The projects of this space an item names; another space's card names only those. */
function namedProjects(item: WorkItemBrief, own: ReadonlySet<string> | null): string[] {
  const named = [...new Set(item.projects.map((project) => project.project_id))]
  return item.other_space && own ? named.filter((id) => own.has(id)) : named
}

/**
 * The group by project an item stands in, the list's as the board's: the one project of
 * the space it names, several, or none.
 */
export function projectGroupOf(projects: readonly SpaceProject[] | null | undefined) {
  const own = projects ? new Set(projects.map((p) => p.project_id)) : null
  return (item: WorkItemBrief): string => {
    const named = namedProjects(item, own)
    if (named.length > 1) return SEVERAL_PROJECTS
    return named.length ? projectLane(named[0] ?? '') : NO_PROJECT
  }
}

/** The groups by project, in the order they are read: the space's projects, then the rest. */
export function projectGroups(projects: readonly SpaceProject[] | null | undefined): string[] {
  return [...(projects ?? []).map((p) => projectLane(p.project_id)), SEVERAL_PROJECTS, NO_PROJECT]
}

function laneReader(input: LaneInput, byId: ReadonlyMap<string, WorkItemBrief>): LaneOf {
  const grouping = input.grouping ?? 'goal'
  if (grouping === 'project') {
    const groupOf = projectGroupOf(input.projects)
    return (item) => (isContainer(item) && item.state === null ? undefined : groupOf(item))
  }
  return (item) => {
    if (item.other_space) return spaceLane(item.other_space.key)
    if (grouping === 'stage') {
      return isContainer(item)
        ? null
        : (ancestorsOf(item, byId).find((parent) => isContainer(parent))?.work_item_id ?? NO_PARENT)
    }
    // By goal a lane is a root's: a container that is nobody's child.
    if (item.parent_id === null && isContainer(item)) return null
    const root = ancestorsOf(item, byId).find(
      (parent) => parent.parent_id === null && isContainer(parent),
    )
    return root?.work_item_id ?? NO_PARENT
  }
}

/** What heads the lane of this id. */
function headOf(
  id: string,
  input: LaneInput,
  byId: ReadonlyMap<string, WorkItemBrief>,
  spaces: ReadonlyMap<string, string>,
): LaneHead {
  if (id === NO_PARENT) return { kind: 'no-goal' }
  if (id === SEVERAL_PROJECTS) return { kind: 'several-projects' }
  if (id === NO_PROJECT) return { kind: 'no-project' }
  if (id.startsWith('space:')) {
    const key = id.slice('space:'.length)
    return { kind: 'space', key, name: spaces.get(key) ?? key }
  }
  if (id.startsWith('project:')) {
    const project = id.slice('project:'.length)
    const name = input.projects?.find((p) => p.project_id === project)?.display_name
    return { kind: 'project', id: project, name: name ?? project }
  }
  const item = byId.get(id)
  if (item === undefined) return { kind: 'no-goal' }
  const path = input.grouping === 'stage' ? ancestorsOf(item, byId).reverse() : []
  return { kind: 'container', item, path }
}

/**
 * By goal, the stage a tile in this lane stands under: its parent, where that is a
 * container and not the lane's own goal. By stage the lane is the stage, and by project
 * the lane says no goal, so neither names one.
 */
function stageReader(input: LaneInput, byId: ReadonlyMap<string, WorkItemBrief>) {
  const named = (input.grouping ?? 'goal') === 'goal'
  return (item: WorkItemBrief, lane: string): WorkItemBrief | undefined => {
    const stage = named ? byId.get(item.parent_id ?? '') : undefined
    return stage && isContainer(stage) && stage.work_item_id !== lane ? stage : undefined
  }
}

/** Puts each tile the filter let through in its lane, with the stage it names. */
function drawTiles(
  input: LaneInput,
  laneOf: LaneOf,
  lane: (id: string) => BoardLane,
  stageOf: ReturnType<typeof stageReader>,
) {
  for (const item of input.visible) {
    const id = laneOf(item)
    if (id === undefined || id === null) continue
    const found = lane(id)
    found.items.push(item)
    const stage = stageOf(item, id)
    if (stage) (found.stages as Map<string, WorkItemBrief>).set(item.work_item_id, stage)
  }
}

/** What heads the group by project of this id (`projectGroupOf`). */
export const projectHead = (id: string, projects: readonly SpaceProject[] | null | undefined) =>
  headOf(
    id,
    { filtered: false, grouping: 'project', projects, scope: [], space: [], visible: [] },
    new Map(),
    new Map(),
  )

/** This space's lanes first, then the work under no goal, then other spaces'. */
const laneKind = (lane: BoardLane) =>
  lane.head.kind === 'space' ? 2 : Number(lane.id === NO_PARENT)

/** The order the lanes are read in, smaller first. */
function laneRank(input: LaneInput, order: ReadonlyMap<string, number>) {
  if (input.grouping === 'project') {
    const ranks = new Map(projectGroups(input.projects).map((id, at) => [id, at]))
    return (lane: BoardLane): number[] => [ranks.get(lane.id) ?? ranks.size]
  }
  // This space's lanes with open work, then the rest, then the work under no goal, then the
  // lanes of other spaces by their key.
  return (lane: BoardLane): number[] => [
    laneKind(lane),
    Number(lane.open === 0 && laneKind(lane) === 0),
    order.get(lane.id) ?? 0,
  ]
}

const compareRanks = (left: number[], right: number[]) => {
  for (const [at, value] of left.entries()) {
    const other = right[at] ?? 0
    if (value !== other) return value - other
  }
  return 0
}

/**
 * The lanes, in reading order. Under a filter a lane with nothing to draw is left out,
 * or a search would answer with a column of empty lane headings; without one every
 * goal, stage or project keeps its lane, an empty one included, so a new goal is
 * visible before it holds work. A lane no card or project heads shows only with work.
 */
export function boardLanes(input: LaneInput): BoardLane[] {
  const order = new Map(input.space.map((item, index) => [item.work_item_id, index]))
  const byId = new Map(input.space.map((item) => [item.work_item_id, item]))
  const spaces = new Map(
    input.space.flatMap((item) =>
      item.other_space ? [[item.other_space.key, item.other_space.name]] : [],
    ),
  )
  const laneOf = laneReader(input, byId)
  const lanes = new Map<string, BoardLane>()
  const lane = (id: string): BoardLane => {
    let found = lanes.get(id)
    if (found === undefined) {
      const head = headOf(id, input, byId, spaces)
      const goal = head.kind === 'container' ? head.item : null
      found = { id, goal, head, items: [], open: 0, closed: 0, stages: new Map() }
      lanes.set(id, found)
    }
    return found
  }
  if (input.grouping === 'project')
    for (const project of input.projects ?? []) lane(projectLane(project.project_id))
  for (const item of input.scope) {
    const id = laneOf(item)
    if (id === undefined) continue
    if (id === null) {
      lane(item.work_item_id)
      continue
    }
    const counted = lane(id)
    if (WORK_ITEM_TREE.isOpen(item)) counted.open += 1
    else counted.closed += 1
  }
  drawTiles(input, laneOf, lane, stageReader(input, byId))
  const rank = laneRank(input, order)
  return [...lanes.values()]
    .filter((entry) => !input.filtered || entry.items.length > 0)
    .filter(
      (entry) =>
        entry.goal !== null || entry.head.kind === 'project' || entry.open + entry.closed > 0,
    )
    .sort((left, right) => compareRanks(rank(left), rank(right)))
}

/** A state a lane holds work in, and how much. */
export interface HeldIn<State> {
  count: number
  state: State
}

/**
 * What a lane holds out of sight on each side of the columns `first` to `last`.
 * Finished work is counted in the lane's heading already, so a terminal state
 * is named only when nothing of the lane is in view.
 */
export function outOfSight<State extends { is_terminal: boolean }>(
  states: readonly State[],
  first: number,
  last: number,
  count: (state: State) => number,
): { left: HeldIn<State>[]; right: HeldIn<State>[] } {
  const seen = states.slice(first, last + 1).some((state) => count(state) > 0)
  const held = (side: readonly State[]) =>
    side
      .map((state) => ({ state, count: count(state) }))
      .filter((entry) => entry.count > 0 && (!entry.state.is_terminal || !seen))
  return { left: held(states.slice(0, first)), right: held(states.slice(last + 1)) }
}
