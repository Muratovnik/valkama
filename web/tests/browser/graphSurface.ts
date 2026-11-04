/**
 * The harness page for the graph's own drawings: a laid-out field of frames,
 * cards and lines, drawn with the product's components on a field the size the
 * browser gives it, with live work on it and the switch that stops it moving.
 *
 * The field is the sample layout (`placedSample`): the epic with the long
 * title open round two cards, the largest epic and the work under no epic
 * folded, a line inside the open frame and one folded onto a frame. The first
 * card is being worked on and the second has fallen silent, so the line
 * between them runs and the one folded onto the largest epic does not.
 * `?live=folded` also puts an agent to work inside the largest epic, which
 * runs that line too, and `?live=held` has the second card held by a session
 * that is working on something else. Folding a frame here turns its header and
 * nothing else.
 *
 * `?zoom=read` opens the field from its top-left at reading size and
 * `?zoom=out` far out, past reading.
 */
import { computed, defineComponent, h, ref, shallowRef } from 'vue'

import { useVueFlow } from '@vue-flow/core'

import GraphEdge from '@/widgets/work-item-graph/components/GraphEdge.vue'
import GraphField from '@/widgets/work-item-graph/components/GraphField.vue'
import GraphFieldCorner from '@/widgets/work-item-graph/components/GraphFieldCorner.vue'
import GraphFrame from '@/widgets/work-item-graph/components/GraphFrame.vue'
import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import { useGraphFlowElements } from '@/widgets/work-item-graph/composables/useGraphFlowElements.ts'
import { movesOn, useGraphMotion } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'
import { GRAPH_FLOW_ID } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { LiveWork } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'

import { placedSample } from '../fixtures/graphSample.ts'

const NO_NAMES = Object.fromEntries(
  ['active', 'review', 'queued', 'backlog', 'blocked', 'done'].map((group) => [group, null]),
) as Record<ChainGroup, string | null>

/** Who is at work on the sample, as the server's `live_work` would say it. */
function liveOn(layout: GraphLayout, kind: string | null): Record<string, LiveWork> {
  const [first, second] = layout.nodes
  const live: Record<string, LiveWork> = {
    [first.work_item_id]: { state: 'working' },
    [second.work_item_id]: { state: 'quiet', quiet_since: '2026-11-02T08:00:00Z' },
  }
  const inside = layout.edges[1].links[0].to
  if (kind === 'folded') live[inside] = { state: 'working' }
  if (kind === 'held') live[second.work_item_id] = { state: 'held' }
  return live
}

export const GraphSurface = defineComponent({
  setup() {
    const query = new URLSearchParams(location.search)
    const zoom = query.get('zoom')
    const zoomedOut = zoom === 'out'
    const placed = shallowRef<GraphLayout | null>(placedSample())
    const live = liveOn(placedSample(), query.get('live'))
    const moving = computed(() => new Set(Object.keys(live).filter((id) => movesOn(live[id]))))
    const { motion, toggle: toggleMotion } = useGraphMotion()
    const still = computed(() => motion.value !== 'running')
    const { nodes, edges } = useGraphFlowElements({ focusSet: ref(null), placed, moving })
    const { fitView, setViewport, zoomTo } = useVueFlow({ id: GRAPH_FLOW_ID })

    const settled = ref(false)
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
              motion: motion.value,
              moving: moving.value.size > 0,
              held: Object.values(live).some((work) => work.state === 'held'),
              onToggleMotion: toggleMotion,
            }),
          ]),
          h(
            GraphField,
            {
              nodes: nodes.value,
              edges: edges.value,
              motion: motion.value,
              settled: settled.value,
              onInit,
            },
            {
              edge: (edge: { data: never; id: string; markerEnd: string }) =>
                h(GraphEdge, {
                  id: edge.id,
                  data: edge.data,
                  markerEnd: edge.markerEnd,
                  motion: motion.value,
                }),
              frame: ({ data }: { data: { id: string } }) =>
                frameAt(data.id).map((frame) =>
                  h(GraphFrame, {
                    frame,
                    overview: zoomedOut,
                    still: still.value,
                    working: frame.members.filter((id) => moving.value.has(id)).length,
                    onToggle: toggle,
                  }),
                ),
              card: ({ data }: { data: { id: string } }) =>
                cardAt(data.id).map((node) =>
                  h(GraphNodeCard, {
                    node,
                    ready: false,
                    recessed: false,
                    framed: framed(node.frameId),
                    overview: zoomedOut,
                    live: live[node.work_item_id] ?? null,
                    still: still.value,
                  }),
                ),
            },
          ),
        ]),
      ])
  },
})
