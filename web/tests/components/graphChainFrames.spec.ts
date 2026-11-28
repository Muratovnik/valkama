/**
 * The graph field scoped to a chain grown from a goal, which stands in frames:
 * the root its outer frame, the work found elsewhere in a band of its own, and
 * the branch the card chose.
 */
import { ref } from 'vue'

import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GraphFrame from '@/widgets/work-item-graph/components/GraphFrame.vue'
import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import { FOUND_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { PlanningEdge } from '@/shared/api/planningModel.ts'

import {
  chain,
  drawn,
  flowLines,
  id,
  item,
  items,
  known,
  OPEN,
  openGraph,
} from '../fixtures/graphChainScope.ts'

const dimensions = ref({ width: 1200, height: 680 })
const viewport = ref({ x: 0, y: 0, zoom: 1 })

vi.mock('@vue-flow/core', async (original) => ({
  ...(await original<typeof import('@vue-flow/core')>()),
  useVueFlow: () => ({
    fitView: vi.fn().mockResolvedValue(true),
    setViewport: vi.fn().mockResolvedValue(true),
    dimensions,
    viewport,
    minZoom: ref(0.01),
    maxZoom: ref(1.45),
    vueFlowRef: ref(null),
  }),
}))

vi.mock('@/widgets/work-item-graph/utils/graphLayoutEngine.ts', () => ({
  createGraphLayoutEngine: () => {
    const elk = new ELK()
    return { layout: elk.layout.bind(elk), terminateWorker: vi.fn() }
  },
}))

const chainEdges: PlanningEdge[] = [{ from: id(4), to: id(2), kind: 'discovered-from' }]
const openGoalChain = (props: Record<string, unknown> = {}) =>
  openGraph({ scopeKind: 'chain', scopeRootId: id(1), chain, edges: chainEdges, ...props })
const frameNamed = (graph: ReturnType<typeof openGraph>, frameId: string) =>
  graph.findAllComponents(GraphFrame).find((entry) => entry.props('frame').id === frameId)

describe('a chain grown from a goal, drawn in frames', () => {
  // A fold a test chooses is kept in this browser's storage; the next test starts without it.
  afterEach(() => localStorage.clear())

  it('draws the root as the outer frame, marked as the root, and the work found elsewhere in a band of its own', async () => {
    const graph = openGoalChain()
    // The root is its frame, not a card; 3 stands in it and 4, under no goal, in the band.
    expect(await drawn(graph)).toEqual(['MAIN-3', 'MAIN-4'])
    const frames = graph.findAllComponents(GraphFrame)
    const frameIds = frames.map((entry) => entry.props('frame').id)
    expect(frameIds.sort((left, right) => left.localeCompare(right))).toEqual([id(1), FOUND_FRAME])
    const frameOf = (reference: string) =>
      graph
        .findAllComponents(GraphNodeCard)
        .find((entry) => entry.props('node').reference === reference)
        ?.props('node').frameId
    expect([frameOf('MAIN-3'), frameOf('MAIN-4')]).toEqual([id(1), FOUND_FRAME])
    // The root's header says so, in its word and its accessible name; the band's does not.
    const root = frameNamed(graph, id(1))
    expect(root?.get('.graph-frame-root').text()).toBe('root')
    expect(root?.get('button[aria-label^="Goal"]').attributes('aria-label')).toMatch(
      /^Goal MAIN-1 “item 1” · chain root · /,
    )
    const band = frameNamed(graph, FOUND_FRAME)
    expect(band?.text()).toContain('Found in the chain')
    expect(band?.find('.graph-frame-root').exists()).toBe(false)
    // No card says root: the frame does.
    expect(graph.findAllComponents(GraphNodeCard)).toHaveLength(2)
    expect(graph.find('.flow-node-root').exists()).toBe(false)
  })

  it('adds the closed members to their frames when the switch is thrown, and draws only the links among drawn cards', async () => {
    const edges: PlanningEdge[] = [
      ...chainEdges,
      { from: id(5), to: id(3), kind: 'blocks', reference: 'MAIN-5', ...known(true) },
    ]
    const graph = openGoalChain({ edges })
    expect(await drawn(graph)).toEqual(['MAIN-3', 'MAIN-4'])
    expect(graph.get('[role="switch"]').text()).toBe('Closed · 1')
    await graph.get('[role="switch"]').trigger('click')
    expect(await drawn(graph)).toEqual(['MAIN-2', 'MAIN-3', 'MAIN-4'])
    const card = graph
      .findAllComponents(GraphNodeCard)
      .find((entry) => entry.props('node').reference === 'MAIN-2')
    expect(card?.props('recessed')).toBe(true)
    // From 2 to 4, found on its way; 5 is not of the chain, so its link is not drawn.
    expect(flowLines(graph)).toEqual([[id(2), id(4)]])
  })

  it('names in its legend the done part the root frame’s edge draws, with the closed work hidden or not', async () => {
    const graph = openGoalChain()
    await drawn(graph)
    const key = '.graph-canvas .graph-legend-state'
    const named = () => graph.findAll(`${key}:not(.held)`).map((entry) => entry.text())
    // 2 is closed and hidden, but the root frame's edge counts it as done.
    expect(named()).toEqual(['Done', 'Ready'])
    expect(graph.find(`${key}.held`).exists()).toBe(false)
    await graph.get('[role="switch"]').trigger('click')
    await drawn(graph)
    expect(named()).toEqual(['Done', 'Ready'])
  })

  it('keeps in its key the place of what a fold hides, so folding the root moves no word', async () => {
    const deferred = { ...OPEN, state_id: 'deferred', key: 'deferred', name: 'Deferred' }
    const graph = openGoalChain({
      items: items.map((entry) =>
        entry.reference === 'MAIN-3'
          ? { ...entry, state: { ...deferred, category: 'deferred' as const } }
          : entry,
      ),
      live: { [id(3)]: { state: 'held' } },
    })
    expect(await drawn(graph)).toEqual(['MAIN-3', 'MAIN-4'])
    const key = '.graph-canvas .graph-legend'
    const places = () => graph.findAll(`${key} > *`).map((entry) => entry.text())
    const named = () => graph.findAll(`${key} > :not(.held)`).map((entry) => entry.text())
    const open = places()
    // Open, 3 draws its group and its session's sign, and the key names both.
    expect(named()).toEqual(open)
    expect(open).toContain('Deferred')
    expect(graph.findAll(`${key} [data-sign]`)).toHaveLength(1)
    await graph.get('button[aria-label^="Collapse goal MAIN-1"]').trigger('click')
    expect(await drawn(graph)).toEqual(['MAIN-4'])
    // Folded, 3 is not drawn: its words keep their places, unseen.
    expect(places()).toEqual(open)
    expect(named()).not.toContain('Deferred')
    expect(graph.findAll(`${key} .held[data-sign]`)).toHaveLength(1)
  })

  it('marks the frame of the branch the card chose, and keeps the branch when that frame is folded over it', async () => {
    // 3 is filed under stage 9 of the root; the card chose that stage's branch.
    const staged = [
      ...items.map((entry) =>
        entry.reference === 'MAIN-3' ? { ...entry, parent_id: id(9) } : entry,
      ),
      item(9, { kind: 'stage', parent_id: id(1) }),
    ]
    const graph = openGoalChain({
      items: staged,
      chain: { members: [id(2), id(3), id(4), id(9)], reference: 'MAIN-1', total: 4 },
      branch: { head: id(9), members: [id(3)], reference: 'MAIN-9' },
    })
    expect(await drawn(graph)).toEqual(['MAIN-3', 'MAIN-4'])
    const frames = () => graph.findAllComponents(GraphFrame)
    const marked = () =>
      frames()
        .filter((entry) => entry.props('marked'))
        .map((entry) => entry.props('frame').id)
    const card = (reference: string) =>
      graph
        .findAllComponents(GraphNodeCard)
        .find((entry) => entry.props('node').reference === reference)
    expect(frames()).toHaveLength(3)
    expect(marked()).toEqual([id(9)])
    expect([card('MAIN-3')?.props('marked'), card('MAIN-4')?.props('marked')]).toEqual([
      true,
      false,
    ])
    expect(graph.get('.graph-branch-chip').text()).toContain('MAIN-9')
    // Folded, the stage draws none of the branch's cards and still stands for the branch.
    await graph.get('button[aria-label="Collapse stage MAIN-9 “item 9”"]').trigger('click')
    expect(await drawn(graph)).toEqual(['MAIN-4'])
    expect(frames()).toHaveLength(3)
    expect(marked()).toEqual([id(9)])
    expect(graph.get('.graph-branch-chip').text()).toContain('MAIN-9')
  })
})
