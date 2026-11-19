/**
 * Which frames a space's graph draws, what each holds, and which lines run
 * between what is drawn.
 *
 * A goal or a stage is drawn as a frame round its
 * work rather than as a card, and the work under none has a frame of its own,
 * so every open item stands somewhere on the field. Another space's work the read
 * holds — its cards that name this space's project, and the far ends of the links
 * between the spaces — stands in a frame of that space, one a space, after this
 * space's frames: it has a parent, only in its own space, so the work under none
 * would say the wrong thing about it, and another space's goal is a card here.
 * A frame folds to its header
 * alone. Whether it starts folded follows from its structure only — how much
 * open work it holds — never from who is working on it, or every turn an agent
 * took would lay the field out again. A frame with nothing the view can draw
 * inside it has nothing to unfold, so it stays folded whatever was stored for
 * it, until the view can draw something there.
 *
 * A link is drawn between the drawn ends it reaches: a card itself, a goal's
 * frame, or the folded frame a card stands in, and runs the way `drawnEnds`
 * says. Several links between one ordered pair of drawn ends are one line,
 * solid when any of them blocks. A link between a
 * card and its own frame is not drawn — the frame already says so — nor one
 * whose end is hidden finished work or lies in a space the read could not read:
 * such an end is neither among the space's items nor among the far ends the read
 * holds, and the projection names that space, so the graph's key can say so.
 *
 * The counts of a frame describe its goal, not the view: every item under it,
 * open and closed, whatever is drawn or a filter lets through.
 */

import {
  drawnEnds,
  NO_PARENT_FRAME,
  spaceFrameId,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { FrameProgress, FrameSpace } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { RoutedEdge } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import { chainGroup } from '@/shared/api/planningChainGroups.ts'
import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { FOLD_ABOVE } from '@/shared/lib/treeRows.ts'

export interface FrameProjectionInput {
  /**
   * The whole space: a frame counts its work whatever the field draws. Another space's
   * items, and the far ends of the links with it, carry `other_space`.
   */
  items: readonly WorkItemBrief[]
  links: readonly PlanningEdge[]
  /** Whether finished work is drawn as cards. */
  showDone: boolean
  /** What the operator chose against each frame's default: true is folded. */
  choices?: Readonly<Record<string, boolean>>
  /** The items a queue or a search lets through; null when nothing narrows. */
  shown?: ReadonlySet<string> | null
}

interface ProjectedFrame {
  /** The cards drawn directly in it while it is open, in reading order. */
  cards: WorkItemBrief[]
  /** Whether it is folded when the operator chose nothing. */
  defaultFolded: boolean
  /** Unfolding it would draw a card or a frame standing in it. */
  foldable: boolean
  folded: boolean
  goal: WorkItemBrief | null
  id: string
  /** Open and closed work under it, nested frames' included. */
  members: string[]
  /** The open work under it the field could draw, nested frames' included. */
  open: number
  parentId: string | null
  progress: FrameProgress
  /** The other space whose work it holds; null for a frame of this space. */
  space: FrameSpace | null
}

/** A line before it is routed. */
type ProjectedEdge = Omit<RoutedEdge, 'points'>

export interface FrameProjection {
  /** Every card drawn, in reading order. */
  cards: WorkItemBrief[]
  edges: ProjectedEdge[]
  /** The drawn frames, each after the frame it stands in, in reading order. */
  frames: ProjectedFrame[]
  /** What decides the geometry; equal keys lay out the same field. */
  key: string
  /**
   * The spaces a link ends in that the read could not read, by key, each once; `''` for
   * an end whose space nothing names. Such a link is not drawn.
   */
  unread: string[]
}

/**
 * An item drawn as a frame: a goal or a stage of this space, as the tree of work reads
 * one. Another space's goal holds nothing here, so it is a card in its space's frame.
 */
const isFrame = (item: WorkItemBrief) => !item.other_space && WORK_ITEM_TREE.isContainer(item)

const open = (item: WorkItemBrief) => WORK_ITEM_TREE.isOpen(item)

const byNumber = (left: WorkItemBrief, right: WorkItemBrief) => left.number - right.number

function progressOf(members: readonly WorkItemBrief[]): FrameProgress {
  const progress = { active: 0, ahead: 0, blocked: 0, done: 0, review: 0, total: members.length }
  for (const member of members) {
    const group = chainGroup(member)
    if (group === 'active' || group === 'review' || group === 'blocked' || group === 'done')
      progress[group] += 1
    else progress.ahead += 1
  }
  return progress
}

/** The space read as a tree of frames: who stands in which, and what is under each. */
function frameTree(items: readonly WorkItemBrief[]) {
  const frames = new Map(
    items.filter((item) => isFrame(item)).map((item) => [item.work_item_id, item]),
  )
  const spaces = new Map<string, FrameSpace>()
  for (const item of items)
    if (item.other_space) spaces.set(spaceFrameId(item.other_space.key), item.other_space)
  const parentOf = (item: WorkItemBrief) =>
    !item.other_space && item.parent_id !== null && frames.has(item.parent_id)
      ? item.parent_id
      : null
  /** The frame an item stands in: its goal, the work under none, or its own space's. */
  const home = (item: WorkItemBrief) =>
    item.other_space ? spaceFrameId(item.other_space.key) : (parentOf(item) ?? NO_PARENT_FRAME)
  const lineage = (frameId: string): string[] => {
    const chain: string[] = []
    for (let at: string | null = frameId; at !== null && !chain.includes(at);) {
      chain.push(at)
      const goal = frames.get(at)
      at = goal ? parentOf(goal) : null
    }
    return chain
  }
  const members = new Map<string, WorkItemBrief[]>()
  for (const item of [...items].sort(byNumber)) {
    if (isFrame(item)) continue
    for (const frameId of lineage(home(item))) {
      const list = members.get(frameId)
      if (list) list.push(item)
      else members.set(frameId, [item])
    }
  }
  return { frames, home, lineage, members, parentOf, spaces }
}

type FrameTree = ReturnType<typeof frameTree>

/**
 * Every frame the field could draw, folded or open, with the cards each draws.
 * Under a filter only a frame the filter found something in is drawn, as a
 * board lane is; without one, a frame with open work, an open goal, and in
 * «All» every goal.
 */
function frameCandidates(
  input: FrameProjectionInput,
  tree: FrameTree,
  drawable: (item: WorkItemBrief) => boolean,
): Map<string, ProjectedFrame> {
  const filtered = Boolean(input.shown)
  const ids = [
    ...tree.frames.keys(),
    ...(tree.members.has(NO_PARENT_FRAME) ? [NO_PARENT_FRAME] : []),
    ...tree.spaces.keys(),
  ]
  const candidates = new Map<string, ProjectedFrame>()
  for (const id of ids) {
    const goal = tree.frames.get(id) ?? null
    const space = tree.spaces.get(id) ?? null
    const members = tree.members.get(id) ?? []
    const visible = members.filter((item) => drawable(item))
    const openWork = visible.filter((item) => open(item)).length
    const wanted = filtered
      ? visible.length > 0
      : openWork > 0 || input.showDone || (goal !== null && open(goal))
    if (!wanted) continue
    // A frame holding more open work than `FOLD_ABOVE`, the count the list's
    // tree folds by too, starts folded, and so does a goal holding none: the
    // field opens on the links of the goals in between, and a large frame shows
    // its progress in its header instead. The work under none is no goal to
    // summarise, so in «All» it folds only past that many drawn cards, and a
    // space with a few finished items draws them. Another space's frame is no goal
    // either, and folds by the same rule.
    const idle = goal !== null || visible.length === 0 || visible.length > FOLD_ABOVE
    const defaultFolded = openWork > FOLD_ABOVE || (openWork === 0 && idle)
    candidates.set(id, {
      id,
      goal,
      space,
      parentId: goal ? tree.parentOf(goal) : null,
      defaultFolded,
      folded: input.choices?.[id] ?? defaultFolded,
      foldable: true,
      open: openWork,
      progress: progressOf(members),
      members: members.map((item) => item.work_item_id),
      cards: visible.filter((item) => tree.home(item) === id).sort(byNumber),
    })
  }
  const holders = new Set([...candidates.values()].map((frame) => frame.parentId))
  for (const frame of candidates.values()) {
    frame.foldable = frame.cards.length > 0 || holders.has(frame.id)
    if (!frame.foldable) frame.folded = true
  }
  return candidates
}

/** The groups a header counts beside what is done, under way or stopped; a zero is not written. */
export function countedGroups(progress: FrameProgress) {
  return (['review', 'active', 'blocked'] as const)
    .filter((group) => progress[group] > 0)
    .map((group) => ({ group, count: progress[group] }))
}

type End = { at: string; inside: string[] }

/**
 * One line per ordered pair of drawn ends, so an arrow keeps its direction —
 * the one `drawnEnds` gives, a discovery from the work it was found in: solid
 * when any link behind it blocks, and otherwise named by the first of its kinds
 * in order, whichever order the links arrived in. A line keeps its links as
 * they are stored.
 */
function drawnLines(
  links: readonly PlanningEdge[],
  endOf: (id: string) => End | null,
): ProjectedEdge[] {
  const lines = new Map<string, ProjectedEdge>()
  for (const link of links) {
    if (link.kind === 'parent') continue
    const drawn = drawnEnds(link)
    const from = endOf(drawn.source)
    const to = endOf(drawn.target)
    if (!from || !to || from.at === to.at) continue
    // A card and the frame it stands in: the frame already says it.
    if (from.inside.includes(to.at) || to.inside.includes(from.at)) continue
    const id = `${from.at}>${to.at}`
    const line = lines.get(id)
    const stored = { from: link.from, to: link.to }
    lines.set(
      id,
      line
        ? { ...line, kind: strongerKind(line.kind, link.kind), links: [...line.links, stored] }
        : { id, source: from.at, target: to.at, kind: link.kind, links: [stored] },
    )
  }
  return [...lines.values()]
    .map((line) => ({ ...line, links: [...line.links].sort(linkOrder) }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function strongerKind(left: PlanningEdge['kind'], right: PlanningEdge['kind']) {
  if (left === 'blocks' || right === 'blocks') return 'blocks'
  return left.localeCompare(right) <= 0 ? left : right
}

/** The frames, which of them are drawn and folded, the cards each draws, and the lines. */
export function frameProjection(input: FrameProjectionInput): FrameProjection {
  const tree = frameTree(input.items)
  const shown = input.shown ?? null
  const drawable = (item: WorkItemBrief) =>
    (input.showDone || open(item)) && (shown === null || shown.has(item.work_item_id))
  const candidates = frameCandidates(input, tree, drawable)

  /** The outermost folded frame round `frameId`, or null when all round it are open. */
  const foldedRound = (frameId: string): string | null =>
    [...tree.lineage(frameId)].reverse().find((id) => candidates.get(id)?.folded) ?? null
  /** A frame is drawn when it and every frame round it are drawn and none round it is folded. */
  const drawnFrame = (id: string) =>
    tree.lineage(id).every((at) => candidates.has(at)) &&
    tree
      .lineage(id)
      .slice(1)
      .every((at) => !candidates.get(at)?.folded)

  const frames = [...candidates.values()].filter((frame) => drawnFrame(frame.id)).sort(frameOrder)
  const cards = frames.filter((frame) => !frame.folded).flatMap((frame) => frame.cards)
  const drawnCards = new Set(cards.map((item) => item.work_item_id))
  const drawnFrames = new Set(frames.map((frame) => frame.id))
  const byId = new Map(input.items.map((item) => [item.work_item_id, item]))

  /** Where a link's end is drawn, and the frames it stands in; null when it is not. */
  function endOf(id: string): End | null {
    const item = byId.get(id)
    if (!item) return null
    if (isFrame(item)) {
      const at = foldedRound(id) ?? id
      return drawnFrames.has(at) ? { at, inside: tree.lineage(id) } : null
    }
    if (!drawable(item)) return null
    const lineage = tree.lineage(tree.home(item))
    const at = foldedRound(tree.home(item)) ?? id
    return drawnFrames.has(at) || drawnCards.has(at) ? { at, inside: lineage } : null
  }

  const edges = drawnLines(input.links, endOf)
  const unread = unreadSpaces(input.links, byId)
  return { frames, cards, edges, key: structureKey(input.showDone, frames, edges), unread }
}

/**
 * The spaces of the link ends the read holds no item for, each once, by key. A link
 * names its source by reference, which carries the key; nothing names a target's.
 */
function unreadSpaces(
  links: readonly PlanningEdge[],
  byId: ReadonlyMap<string, WorkItemBrief>,
): string[] {
  const keys = new Set<string>()
  for (const link of links) {
    if (link.kind === 'parent') continue
    if (!byId.has(link.from)) keys.add(spaceKeyOf(link.reference))
    if (!byId.has(link.to)) keys.add('')
  }
  return [...keys].sort((left, right) => left.localeCompare(right))
}

/** The space key a reference such as `ALPHA-12` starts with; `''` for none. */
const spaceKeyOf = (reference: string | undefined) =>
  reference?.includes('-') ? reference.slice(0, reference.lastIndexOf('-')) : ''

/** Goals in the order the space numbers them, then the work under none, then each other space by key. */
function frameOrder(left: ProjectedFrame, right: ProjectedFrame): number {
  const place = (frame: ProjectedFrame) => {
    if (frame.goal) return 0
    return frame.space ? 2 : 1
  }
  return (
    place(left) - place(right) ||
    (left.goal?.number ?? 0) - (right.goal?.number ?? 0) ||
    (left.space?.key ?? '').localeCompare(right.space?.key ?? '')
  )
}

function linkOrder(left: { from: string; to: string }, right: { from: string; to: string }) {
  return left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
}

/**
 * The structure a layout depends on: the frames and how they are folded, whether
 * each can be, the cards in each, the lines and whether each is solid, and
 * whether finished work is drawn. A state, a holder, live work, a title or a label
 * is laid on the placed field by id and is not part of it.
 */
function structureKey(
  showDone: boolean,
  frames: readonly ProjectedFrame[],
  edges: readonly ProjectedEdge[],
): string {
  return JSON.stringify([
    showDone,
    frames.map((frame) => [
      frame.id,
      frame.parentId,
      frame.folded,
      frame.foldable,
      frame.folded ? [] : frame.cards.map((item) => item.work_item_id),
    ]),
    edges.map((edge) => [edge.id, edge.kind === 'blocks']),
  ])
}
