import { computed, reactive, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { taskAt } from '@/widgets/work-item-inspector/utils/chainBranchDrawing.ts'
import type { LaneDrawing } from '@/widgets/work-item-inspector/utils/chainBranchDrawing.ts'
import { laneRuns } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'
import type { BranchLane } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'

import type { ChainMember } from '@/shared/api/planningChainApi.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'

interface Pointed {
  index: number
  lane: string
}

/** The task a reader is looking at: under the pointer, or under a lane's keyboard cursor. */
export interface ShownTask {
  group: ChainGroup
  index: number
  lane: LaneDrawing
  member: ChainMember
}

interface CursorOptions {
  canvas: Ref<HTMLElement | null>
  drawing: ComputedRef<{ lanes: LaneDrawing[]; unit: number }>
  /** What a task is called aloud when the keyboard cursor reaches it. */
  describe: (lane: BranchLane, index: number) => string
  open: (reference: string) => void
}

/** The start of each stretch of one state, which Page Up and Page Down jump between. */
function stretchStarts(lane: BranchLane): number[] {
  return laneRuns(lane, true).map((run) => run.from)
}

function previousStretch(lane: BranchLane, index: number): number {
  const starts = stretchStarts(lane)
  for (let at = starts.length - 1; at >= 0; at -= 1) if (starts[at] < index) return starts[at]
  return 0
}

/** Where a key moves a cursor at `index`, or null for a key the lane does not take. */
function nextIndex(lane: BranchLane, index: number, key: string): number | null {
  const last = lane.members.length - 1
  switch (key) {
    case 'ArrowRight': {
      return Math.min(last, index + 1)
    }
    case 'ArrowLeft': {
      return Math.max(0, index - 1)
    }
    case 'Home': {
      return 0
    }
    case 'End': {
      return last
    }
    case 'PageDown': {
      return stretchStarts(lane).find((start) => start > index) ?? last
    }
    case 'PageUp': {
      return previousStretch(lane, index)
    }
    default: {
      return null
    }
  }
}

/**
 * Which task of the map is being looked at, by pointer and by keyboard.
 *
 * The pointer is read as an x position over a lane, so a lane of three hundred
 * members costs one listener rather than three hundred. Each lane keeps its own
 * keyboard cursor, which starts where open work does — the part of a lane a
 * reader acts on — and only a keyboard move speaks, so hovering stays quiet.
 */
export function useBranchCursor({ canvas, describe, drawing, open }: CursorOptions) {
  const hovered = ref<Pointed | null>(null)
  const focused = ref<string | null>(null)
  const cursors = reactive(new Map<string, number>())
  const announcement = ref('')

  function laneDrawing(key: string): LaneDrawing | undefined {
    return drawing.value.lanes.find((lane) => lane.lane.key === key)
  }

  function cursorOf(lane: BranchLane): number {
    const at = cursors.get(lane.key) ?? lane.counts.done
    return Math.min(lane.members.length - 1, Math.max(0, at))
  }

  function pointedAt(): Pointed | null {
    if (hovered.value) return hovered.value
    const lane = focused.value === null ? undefined : laneDrawing(focused.value)
    return lane ? { lane: lane.lane.key, index: cursorOf(lane.lane) } : null
  }

  const shown = computed<ShownTask | null>(() => {
    const pointed = pointedAt()
    const lane = pointed && laneDrawing(pointed.lane)
    const member = pointed && lane?.lane.members[pointed.index]
    return pointed && lane && member
      ? { lane, member, index: pointed.index, group: lane.lane.groups[pointed.index] }
      : null
  })

  function indexAt(lane: LaneDrawing, event: MouseEvent): number {
    const box = canvas.value?.getBoundingClientRect()
    return taskAt(lane, event.clientX - (box?.left ?? 0), drawing.value.unit)
  }

  function point(lane: LaneDrawing, event: MouseEvent) {
    hovered.value = { lane: lane.lane.key, index: indexAt(lane, event) }
  }

  function leave() {
    hovered.value = null
  }

  function openAt(lane: LaneDrawing, event: MouseEvent) {
    const member = lane.lane.members[indexAt(lane, event)]
    if (member) open(member.reference)
  }

  function move(lane: LaneDrawing, event: KeyboardEvent) {
    const current = cursorOf(lane.lane)
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open(lane.lane.members[current].reference)
      return
    }
    const next = nextIndex(lane.lane, current, event.key)
    if (next === null) return
    event.preventDefault()
    hovered.value = null
    cursors.set(lane.lane.key, next)
    announcement.value = describe(lane.lane, next)
  }

  function enter(lane: LaneDrawing) {
    focused.value = lane.lane.key
    announcement.value = describe(lane.lane, cursorOf(lane.lane))
  }

  function exit(lane: LaneDrawing) {
    if (focused.value === lane.lane.key) focused.value = null
  }

  /**
   * How much of the panel is visible above a lane's line: the readout stands
   * there only when it fits, since a scrolled panel clips whatever rises past
   * its top edge.
   */
  function roomAbove(lane: LaneDrawing): number {
    const node = canvas.value
    if (!node) return 0
    let scroller = node.parentElement
    while (scroller && !/auto|scroll/u.test(getComputedStyle(scroller).overflowY))
      scroller = scroller.parentElement
    const edge = scroller ? scroller.getBoundingClientRect().top : 0
    return node.getBoundingClientRect().top + (lane.band.top ?? 0) - edge
  }

  return { announcement, cursorOf, enter, exit, leave, move, openAt, point, roomAbove, shown }
}
