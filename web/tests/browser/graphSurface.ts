/**
 * The harness page for the graph's own drawings: a laid-out field of frames,
 * cards and lines, drawn with the product's components on a field the size the
 * browser gives it, before the whole-space projection lays frames out.
 *
 * The field is the sample layout (`placedSample`): the epic with the long
 * title open round two cards, the largest epic and the work under no epic
 * folded, a line inside the open frame and one folded onto a frame. Folding a
 * frame here turns its header and nothing else: the layout is the projection's.
 *
 * `?zoom=out` opens the field zoomed out past reading.
 */
import { defineComponent, h, ref, shallowRef } from 'vue'

import { useVueFlow } from '@vue-flow/core'

import GraphEdge from '@/widgets/work-item-graph/components/GraphEdge.vue'
import GraphField from '@/widgets/work-item-graph/components/GraphField.vue'
import GraphFieldCorner from '@/widgets/work-item-graph/components/GraphFieldCorner.vue'
import GraphFrame from '@/widgets/work-item-graph/components/GraphFrame.vue'
import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import { useGraphFlowElements } from '@/widgets/work-item-graph/composables/useGraphFlowElements.ts'
import { GRAPH_FLOW_ID } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'

import { placedSample } from '../fixtures/graphSample.ts'

const NO_NAMES = Object.fromEntries(
  ['active', 'review', 'queued', 'backlog', 'blocked', 'done'].map((group) => [group, null]),
) as Record<ChainGroup, string | null>

export const GraphSurface = defineComponent({
  setup() {
    const zoom = new URLSearchParams(location.search).get('zoom')
    const zoomedOut = zoom === 'out'
    const placed = shallowRef<GraphLayout | null>(placedSample())
    const { nodes, edges } = useGraphFlowElements({ focusSet: ref(null), placed })
    const { fitView, setViewport, zoomTo } = useVueFlow({ id: GRAPH_FLOW_ID })

    const settled = ref(false)
    /** Whole by default; `?zoom=read` from the top-left at reading size; `?zoom=out` far out. */
    async function onInit() {
      await fitView({ padding: 0.1, maxZoom: 1 })
      if (zoomedOut) await zoomTo(0.3)
      if (zoom === 'read') await setViewport({ x: 16, y: 16, zoom: 1 })
      settled.value = true
    }

    function toggle(id: string) {
      const layout = placed.value
      if (!layout) return
      placed.value = {
        ...layout,
        frames: layout.frames.map((frame) =>
          frame.id === id ? { ...frame, folded: !frame.folded } : frame,
        ),
      }
    }

    const frameAt = (id: string) => placed.value?.frames.filter((frame) => frame.id === id) ?? []
    const cardAt = (id: string) =>
      placed.value?.nodes.filter((node) => node.work_item_id === id) ?? []
    const framed = (frameId: string) => frameAt(frameId).length > 0

    return () =>
      h('main', { 'class': 'graph-harness', 'data-harness': 'graph' }, [
        h('div', { class: 'graph-harness-canvas' }, [
          h('div', { class: 'graph-harness-strip' }, [
            h(GraphFieldCorner, {
              groups: [],
              names: NO_NAMES,
              hasEdges: true,
              keepDone: false,
              readyCount: 3,
            }),
          ]),
          h(
            GraphField,
            { nodes: nodes.value, edges: edges.value, settled: settled.value, onInit },
            {
              edge: (edge: { data: never; id: string; markerEnd: string }) =>
                h(GraphEdge, { id: edge.id, data: edge.data, markerEnd: edge.markerEnd }),
              frame: ({ data }: { data: { id: string } }) =>
                frameAt(data.id).map((frame) =>
                  h(GraphFrame, { frame, overview: zoomedOut, onToggle: toggle }),
                ),
              card: ({ data }: { data: { id: string } }) =>
                cardAt(data.id).map((node) =>
                  h(GraphNodeCard, {
                    node,
                    ready: false,
                    recessed: false,
                    framed: framed(node.frameId),
                    overview: zoomedOut,
                  }),
                ),
            },
          ),
        ]),
      ])
  },
})
