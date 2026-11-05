/**
 * Which frames a space's graph draws, what each holds, and which lines run
 * between what is drawn.
 *
 * An epic — or any item that grew children — is drawn as a frame round its
 * work rather than as a card, and the work under none has a frame of its own,
 * so every open item stands somewhere on the field. A frame folds to its header
 * alone. Whether it starts folded follows from its structure only — how much
 * open work it holds — never from who is working on it, or every turn an agent
 * took would lay the field out again.
 *
 * A link is drawn between the drawn ends it reaches: a card itself, an epic's
 * frame, or the folded frame a card stands in. Several links between one pair
 * of drawn ends are one line, solid when any of them blocks. A link between a
 * card and its own frame is not drawn — the frame already says so — nor one
 * whose end is hidden finished work or lives in another space.
 *
 * The counts of a frame describe its epic, not the view: every item under it,
 * open and closed, whatever is drawn or a filter lets through.
 */

import { NO_EPIC_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { FrameProgress } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { RoutedEdge } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import { chainGroup } from '@/shared/api/planningChainGroups.ts'
import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

/**
 * A frame holding more open work than this starts folded, and so does an epic
 * holding none: the field opens on the links of the epics in between, and a
 * large frame shows its progress in its header instead. The work under none
 * with nothing open folds only past this many drawn cards, so «All» on a space
 * with a few finished items draws them.
 */
export const FOLD_ABOVE = 20

export interface FrameProjectionInput {
  /** The whole space: a frame counts its work whatever the field draws. */
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
  epic: WorkItemBrief | null
  folded: boolean
  id: string
  /** Open and closed work under it, nested frames' included. */
  members: string[]
  /** The open work under it the field could draw, nested frames' included. */
  open: number
  parentId: string | null
  progress: FrameProgress
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
}

/** An item drawn as a frame: an epic, or anything that grew children. */
const isFrame = (item: WorkItemBrief) => item.container || item.kind === 'epic'

const open = (item: WorkItemBrief) => !item.state.is_terminal

const byNumber = (left: WorkItemBrief, right: WorkItemBrief) => left.number - right.number

function progressOf(members: readonly WorkItemBrief[]): FrameProgress {
  const progress = { active: 0, ahead: 0, blocked: 0, done: 0, review: 0, total: members.length }
  for (const member of members) {
    const group = chainGroup(member)
    if (group === 'queued' || group === 'backlog') progress.ahead += 1
    else progress[group] += 1
  }
  return progress
}

/** The space read as a tree of frames: who stands in which, and what is under each. */
function frameTree(items: readonly WorkItemBrief[]) {
  const frames = new Map(
    items.filter((item) => isFrame(item)).map((item) => [item.work_item_id, item]),
  )
  const parentOf = (item: WorkItemBrief) =>
    item.parent_id !== null && frames.has(item.parent_id) ? item.parent_id : null
  /** The frame an item stands in: its epic, or the work under none. */
  const home = (item: WorkItemBrief) => parentOf(item) ?? NO_EPIC_FRAME
  const lineage = (frameId: string): string[] => {
    const chain: string[] = []
    for (let at: string | null = frameId; at !== null && !chain.includes(at);) {
      chain.push(at)
      const epic = frames.get(at)
      at = epic ? parentOf(epic) : null
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
  return { frames, home, lineage, members, parentOf }
}

type FrameTree = ReturnType<typeof frameTree>

/**
 * Every frame the field could draw, folded or open, with the cards each draws.
 * Under a filter only a frame the filter found something in is drawn, as a
 * board lane is; without one, a frame with open work, an open epic, and in
 * «All» every epic.
 */
function frameCandidates(
  input: FrameProjectionInput,
  tree: FrameTree,
  drawable: (item: WorkItemBrief) => boolean,
): Map<string, ProjectedFrame> {
  const filtered = Boolean(input.shown)
  const ids = [...tree.frames.keys(), ...(tree.members.has(NO_EPIC_FRAME) ? [NO_EPIC_FRAME] : [])]
  const candidates = new Map<string, ProjectedFrame>()
  for (const id of ids) {
    const epic = tree.frames.get(id) ?? null
    const members = tree.members.get(id) ?? []
    const visible = members.filter((item) => drawable(item))
    const openWork = visible.filter((item) => open(item)).length
    const wanted = filtered
      ? visible.length > 0
      : openWork > 0 || input.showDone || (epic !== null && open(epic))
    if (!wanted) continue
    // An epic with nothing open folds; the work under none is no epic to
    // summarise, so in «All» it folds only when its finished work is large too.
    const idle = epic !== null || visible.length === 0 || visible.length > FOLD_ABOVE
    const defaultFolded = openWork > FOLD_ABOVE || (openWork === 0 && idle)
    candidates.set(id, {
      id,
      epic,
      parentId: epic ? tree.parentOf(epic) : null,
      defaultFolded,
      folded: input.choices?.[id] ?? defaultFolded,
      open: openWork,
      progress: progressOf(members),
      members: members.map((item) => item.work_item_id),
      cards: visible.filter((item) => tree.home(item) === id).sort(byNumber),
    })
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
 * One line per ordered pair of drawn ends, so an arrow keeps its direction:
 * solid when any link behind it blocks, and otherwise named by the first of
 * its kinds in order, whichever order the links arrived in.
 */
function drawnLines(
  links: readonly PlanningEdge[],
  endOf: (id: string) => End | null,
): ProjectedEdge[] {
  const lines = new Map<string, ProjectedEdge>()
  for (const link of links) {
    if (link.kind === 'parent') continue
    const from = endOf(link.from)
    const to = endOf(link.to)
    if (!from || !to || from.at === to.at) continue
    // A card and the frame it stands in: the frame already says it.
    if (from.inside.includes(to.at) || to.inside.includes(from.at)) continue
    const id = `${from.at}>${to.at}`
    const line = lines.get(id)
    const ends = { from: link.from, to: link.to }
    lines.set(
      id,
      line
        ? { ...line, kind: strongerKind(line.kind, link.kind), links: [...line.links, ends] }
        : { id, source: from.at, target: to.at, kind: link.kind, links: [ends] },
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

  const frames = [...candidates.values()]
    .filter((frame) => drawnFrame(frame.id))
    .sort((left, right) => frameRank(left) - frameRank(right))
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
  return { frames, cards, edges, key: structureKey(input.showDone, frames, edges) }
}

/** Epics in the order the space numbers them, the work under none last. */
function frameRank(frame: ProjectedFrame): number {
  return frame.epic?.number ?? Number.POSITIVE_INFINITY
}

function linkOrder(left: { from: string; to: string }, right: { from: string; to: string }) {
  return left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
}

/**
 * The structure a layout depends on: the frames and how they are folded, the
 * cards in each, the lines and whether each is solid, and whether finished
 * work is drawn. A state, a holder, live work, a title or a label is laid on
 * the placed field by id and is not part of it.
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
      frame.folded ? [] : frame.cards.map((item) => item.work_item_id),
    ]),
    edges.map((edge) => [edge.id, edge.kind === 'blocks']),
  ])
}
