/**
 * The laid-out field as Vue Flow's nodes and edges.
 *
 * A node here is a place and nothing else: its id, its box, whether it is a
 * card or a frame. What a node says — its title, its state, a frame's counts,
 * the work live on it — the field reads by id when it draws the node, so a
 * frame of the stream that changes only those leaves this list as it was and
 * Vue Flow measures nothing again.
 *
 * Frames lie under the lines and the cards over them: a line runs across the
 * frame it crosses and into the card it ends on. A frame inside a frame lies
 * one step above the one it stands in. An edge in the lit lineage takes the
 * accent, and the rest recede while one is lit.
 */

import { computed } from 'vue'
import type { Ref } from 'vue'

import { MarkerType, Position } from '@vue-flow/core'
import type { Edge as FlowEdge, Node as FlowNode } from '@vue-flow/core'

import type { PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { flowEdge } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout, neighborhood } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { PlanningEdge } from '@/shared/api/planningModel.ts'

/** What a drawn node carries: the id the field reads everything else by. */
export interface GraphNodeRef {
  id: string
}

interface FlowElementsInput {
  focusSet: Ref<ReturnType<typeof neighborhood> | null>
  placed: Ref<GraphLayout | null>
  /** The items whose live work moves now; a line any of its links touches runs. */
  moving?: Ref<ReadonlySet<string>>
}

/** Every frame lies below the lines, which Vue Flow draws at zero. */
const FRAME_FLOOR = -100

/** A lit edge takes the accent; an unlit discovery stays quieter than a block. */
function edgeMarkerColor(lit: boolean, kind: PlanningEdge['kind']): string {
  if (lit) return 'var(--color-action-primary)'
  return kind === 'blocks' ? 'var(--color-graph-line)' : 'var(--color-graph-line-muted)'
}

/** How many frames a frame stands inside. */
function depthOf(frame: PlacedFrame, byId: ReadonlyMap<string, PlacedFrame>): number {
  let depth = 0
  const seen = new Set<string>()
  for (let at = frame.parentId; at !== null && !seen.has(at); at = byId.get(at)?.parentId ?? null) {
    seen.add(at)
    depth += 1
  }
  return depth
}

const PLACE = {
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
  draggable: false,
  connectable: false,
  selectable: false,
  focusable: false,
} as const

export function useGraphFlowElements(input: FlowElementsInput) {
  const nodes = computed<FlowNode<GraphNodeRef>[]>(() => {
    const placed = input.placed.value
    if (!placed) return []
    const byId = new Map(placed.frames.map((frame) => [frame.id, frame]))
    const frames = placed.frames.map((frame) => ({
      ...PLACE,
      id: frame.id,
      type: 'frame' as const,
      position: { x: frame.x, y: frame.y },
      width: frame.width,
      height: frame.height,
      zIndex: FRAME_FLOOR + depthOf(frame, byId),
      class: 'graph-frame-node',
      data: { id: frame.id },
    }))
    const cards = placed.nodes.map((node) => ({
      ...PLACE,
      id: node.work_item_id,
      type: 'card' as const,
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      class: 'graph-node',
      data: { id: node.work_item_id },
    }))
    return [...frames, ...cards]
  })

  const edges = computed<FlowEdge[]>(() => {
    if (!input.placed.value) return []
    const focusedEdges = input.focusSet.value?.edges
    const moving = input.moving?.value ?? new Set<string>()
    return input.placed.value.edges.map((edge) => {
      const lit = focusedEdges?.has(edge.id) ?? false
      const recessed = focusedEdges != null && !lit
      const markerColor = edgeMarkerColor(lit, edge.kind)
      const descriptor = flowEdge(edge, { markerColor, lit, recessed })
      // A line stands for every link drawn into it, folded ones too: it runs
      // when any of them reaches work that moves.
      const live = edge.links.some((link) => moving.has(link.from) || moving.has(link.to))
      return {
        ...descriptor,
        class: live ? [...descriptor.class, 'live'] : descriptor.class,
        data: { ...descriptor.data, live },
        markerEnd: { ...descriptor.markerEnd, type: MarkerType.ArrowClosed },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      } as FlowEdge
    })
  })

  return { nodes, edges }
}
