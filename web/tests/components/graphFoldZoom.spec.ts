/**
 * The zoom a fold takes and gives back: the root of a chain folded at the whole
 * view raises the camera to the folded drawing's whole view, and opening it again
 * returns the zoom the operator had, unless the operator moved the camera between.
 */
import { ref } from 'vue'

import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlanningEdge } from '@/shared/api/planningModel.ts'

import { chain, drawn, id, openGraph } from '../fixtures/graphChainScope.ts'

/** A field small enough that the open chain does not fit it at full size. */
const dimensions = ref({ width: 640, height: 400 })
const viewport = ref({ x: 0, y: 0, zoom: 1 })

vi.mock('@vue-flow/core', async (original) => ({
  ...(await original<typeof import('@vue-flow/core')>()),
  useVueFlow: () => ({
    fitView: vi.fn().mockResolvedValue(true),
    // The camera stands where it is put, as Vue Flow's does.
    setViewport: vi.fn((target: { x: number; y: number; zoom: number }) => {
      viewport.value = { ...target }
      return Promise.resolve(true)
    }),
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

/** The chain grown from goal 1 with the camera at its whole view, the farthest out it goes. */
async function atWholeView() {
  const graph = openGraph({ scopeKind: 'chain', scopeRootId: id(1), chain, edges: chainEdges })
  await drawn(graph)
  const whole = wholeZoom(graph)
  viewport.value = { x: 0, y: 0, zoom: whole }
  return { graph, whole }
}

/** The whole view's zoom the field hands Vue Flow as its limit. */
function wholeZoom(graph: Awaited<ReturnType<typeof atWholeView>>['graph']) {
  return Number(graph.findComponent({ name: 'VueFlow' }).attributes('min-zoom'))
}

async function press(graph: Awaited<ReturnType<typeof atWholeView>>['graph'], label: string) {
  await graph.get(`.graph-frame button[aria-label^="${label} goal MAIN-1"]`).trigger('click')
  await drawn(graph)
}

describe('a fold that raised the zoom', () => {
  // A fold a test chooses is kept in this browser's storage; the next test starts without it.
  afterEach(() => localStorage.clear())

  it('gives the zoom back as the frame opens again', async () => {
    const { graph, whole } = await atWholeView()
    await press(graph, 'Collapse')
    // Folded, the drawing's whole view is nearer, and the camera came up to it.
    await vi.waitFor(() => expect(viewport.value.zoom).toBeGreaterThan(whole + 0.01))
    expect(viewport.value.zoom).toBeCloseTo(wholeZoom(graph), 6)
    await press(graph, 'Expand')
    await vi.waitFor(() => expect(viewport.value.zoom).toBeCloseTo(whole, 6))
  })

  it('keeps the zoom the camera has once the operator moved it after the fold', async () => {
    const { graph, whole } = await atWholeView()
    await press(graph, 'Collapse')
    await vi.waitFor(() => expect(viewport.value.zoom).toBeGreaterThan(whole + 0.01))
    const raised = viewport.value.zoom
    // The operator pans: the zoom is theirs now.
    viewport.value = { ...viewport.value, x: viewport.value.x + 40 }
    await press(graph, 'Expand')
    await vi.waitFor(() => expect(wholeZoom(graph)).toBeCloseTo(whole, 6))
    expect(viewport.value.zoom).toBeCloseTo(raised, 6)
  })
})
