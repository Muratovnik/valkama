/**
 * The laid-out field as Vue Flow's nodes and edges.
 *
 * Every node is drawn and never edited: not dragged, connected, selected or
 * focused by Vue Flow itself, since the card inside it is the control. An edge
 * in the lit lineage takes the accent, and the rest recede while one is lit.
 */

import { computed } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { MarkerType, Position } from '@vue-flow/core'
import type { Edge as FlowEdge, Node as FlowNode } from '@vue-flow/core'

import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { edgeKey, flowEdge } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout, neighborhood } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { PlanningEdge } from '@/shared/api/planningModel.ts'

interface FlowElementsInput {
  focusSet: Ref<ReturnType<typeof neighborhood> | null>
  placed: Ref<GraphLayout | null>
  isChainRoot: (node: PlacedNode) => boolean
}

/** A lit edge takes the accent; an unlit discovery stays quieter than a block. */
function edgeMarkerColor(lit: boolean, kind: PlanningEdge['kind']): string {
  if (lit) return 'var(--color-action-primary)'
  return kind === 'blocks' ? 'var(--color-graph-line)' : 'var(--color-graph-line-muted)'
}

export function useGraphFlowElements(input: FlowElementsInput) {
  const { t } = useI18n()

  const nodes = computed<FlowNode<PlacedNode>[]>(() => {
    if (!input.placed.value) return []
    return input.placed.value.nodes.map((node) => ({
      id: node.work_item_id,
      type: 'card' as const,
      position: { x: node.x, y: node.y },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: false,
      connectable: false,
      selectable: false,
      focusable: false,
      ariaLabel: [
        `${node.reference} ${node.title}`,
        node.state.name,
        ...(input.isChainRoot(node) ? [t('graph.rootLabel')] : []),
      ].join(' · '),
      class: 'graph-node',
      data: node,
    }))
  })

  const edges = computed<FlowEdge[]>(() => {
    if (!input.placed.value) return []
    const focusedEdges = input.focusSet.value?.edges
    return input.placed.value.edges.map((edge) => {
      const key = edgeKey(edge)
      const lit = focusedEdges?.has(key) ?? false
      const recessed = focusedEdges != null && !lit
      const markerColor = edgeMarkerColor(lit, edge.kind)
      const descriptor = flowEdge(edge, { markerColor, lit, recessed })
      return {
        ...descriptor,
        markerEnd: { ...descriptor.markerEnd, type: MarkerType.ArrowClosed },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      } as FlowEdge
    })
  })

  return { nodes, edges }
}
