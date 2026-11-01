import { nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import ELK from 'elkjs/lib/elk.bundled.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GraphBar from '@/widgets/work-item-graph/components/GraphBar.vue'
import GraphView from '@/widgets/work-item-graph/components/GraphView.vue'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

const camera = vi.hoisted(() => ({
  fitView: vi.fn().mockResolvedValue(true),
  setViewport: vi.fn().mockResolvedValue(true),
  initialized: false,
  mounts: vi.fn(),
}))
const dimensions = ref({ width: 1200, height: 680 })
const viewport = ref({ x: 0, y: 0, zoom: 1 })
const zoomLimits = { minZoom: ref(0.01), maxZoom: ref(1.45) }

vi.mock('@vue-flow/core', async (original) => ({
  ...(await original<typeof import('@vue-flow/core')>()),
  useVueFlow: () => ({ ...camera, ...zoomLimits, dimensions, viewport }),
}))

vi.mock('@/widgets/work-item-graph/utils/graphLayoutEngine.ts', () => ({
  createGraphLayoutEngine: () => {
    const elk = new ELK()
    return { layout: elk.layout.bind(elk), terminateWorker: vi.fn() }
  },
}))

const item: WorkItemBrief = {
  work_item_id: 'work-1',
  planning_space_id: 'space-1',
  reference: 'TEST-1',
  number: 1,
  title: 'Readable work',
  kind: 'task',
  priority: 'medium',
  state: { state_id: 'todo', key: 'todo', name: 'Todo', category: 'queued', is_terminal: false },
  claim_ref: '',
  claim_state: null,
  parent_id: null,
  container: false,
  ready: true,
  labels: [],
  source: '',
  checklist: [],
  revision: 0,
  created_at: '2026-10-22T10:00:00Z',
  updated_at: '2026-10-22T10:00:00Z',
  comment_count: 0,
}

async function openGraph(items = [item], space = 'space-1') {
  const graph = mount(GraphView, {
    props: {
      items,
      edges: [],
      epicId: null,
      open: true,
      scopeKind: 'all',
      space,
      version: 1,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: {
        VueFlow: {
          name: 'VueFlow',
          template: '<div><slot /></div>',
          emits: ['init'],
          mounted() {
            camera.mounts()
            if (camera.initialized) return
            camera.initialized = true
            this.$emit('init')
          },
        },
        Controls: { template: '<div><slot /></div>' },
        Background: true,
      },
    },
  })
  await vi.waitFor(() => expect(graph.findComponent({ name: 'VueFlow' }).exists()).toBe(true))
  await vi.waitFor(() => expect(camera.setViewport).toHaveBeenCalled())
  return graph
}

describe('graph camera ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    camera.initialized = false
    dimensions.value = { width: 1200, height: 680 }
    viewport.value = { x: 0, y: 0, zoom: 1 }
  })

  it('places the first camera and preserves it across revision, data, and selection refreshes', async () => {
    const graph = await openGraph()
    expect(camera.setViewport).toHaveBeenCalledTimes(1)
    expect(graph.get('.graph-canvas').classes()).toContain('settled')
    await graph.setProps({
      version: 2,
      items: [{ ...item, title: 'Updated work', revision: 1 }],
      selectedId: item.work_item_id,
    })
    await flushPromises()
    await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBe('false'))
    expect(camera.setViewport).toHaveBeenCalledTimes(1)
    graph.unmount()
  })

  it('leaves the camera where it is for a new narrowing that keeps work in sight, and for its refresh', async () => {
    const other = { ...item, work_item_id: 'work-2', reference: 'TEST-2', number: 2 }
    const graph = await openGraph([item, other])
    expect(camera.setViewport).toHaveBeenCalledTimes(1)
    // The queue or the search narrowed the items, and what is left stands in sight.
    await graph.setProps({ items: [other], filter: '["ready","test-2"]' })
    await flushPromises()
    await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBe('false'))
    expect(camera.setViewport).toHaveBeenCalledTimes(1)
    // The same narrowing refreshed by the stream: the camera stays.
    await graph.setProps({ items: [{ ...other, revision: 1 }], version: 2 })
    await flushPromises()
    await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBe('false'))
    expect(camera.setViewport).toHaveBeenCalledTimes(1)
    graph.unmount()
  })

  it('pans onto a narrowing that left nothing in sight, at the zoom the operator chose', async () => {
    const other = { ...item, work_item_id: 'work-2', reference: 'TEST-2', number: 2 }
    const graph = await openGraph([item, other])
    // The operator zoomed and panned far from the work.
    viewport.value = { x: -40_000, y: -40_000, zoom: 0.6 }
    await graph.setProps({ items: [other], filter: '["ready","test-2"]' })
    await vi.waitFor(() => expect(camera.setViewport).toHaveBeenCalledTimes(2))
    expect(camera.setViewport.mock.calls.at(-1)?.[0]).toMatchObject({ zoom: 0.6 })
    // A switch narrows the same way: with work in sight again, it moves nothing.
    viewport.value = camera.setViewport.mock.calls.at(-1)?.[0] as typeof viewport.value
    graph.findComponent(GraphBar).vm.$emit('update:showUnlinked', true)
    await nextTick()
    await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBe('false'))
    expect(camera.setViewport).toHaveBeenCalledTimes(2)
    graph.unmount()
  })

  it('finds the camera where it was left on coming back to the same scope from another view', async () => {
    const graph = await openGraph([item], 'space-return')
    viewport.value = { x: 140, y: 60, zoom: 0.8 }
    graph.unmount()
    camera.initialized = false
    vi.clearAllMocks()
    const again = await openGraph([item], 'space-return')
    expect(camera.setViewport).toHaveBeenCalledTimes(1)
    expect(camera.setViewport.mock.calls[0]?.[0]).toEqual({ x: 140, y: 60, zoom: 0.8 })
    again.unmount()
  })

  it('keeps the initialized canvas alive through repeated open/all filters and empty projections', async () => {
    const done = {
      ...item,
      work_item_id: 'done-1',
      ready: false,
      state: { ...item.state, name: 'Done', category: 'completed' as const, is_terminal: true },
    }
    const graph = await openGraph([item, done])
    const flow = graph.findComponent({ name: 'VueFlow' }).vm
    for (const showDone of [true, false, true, false]) {
      graph.findComponent(GraphBar).vm.$emit('update:showDone', showDone)
      await nextTick()
      await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBe('false'))
      await vi.waitFor(() => expect(graph.get('.graph-canvas').classes()).toContain('settled'))
      expect(graph.findComponent({ name: 'VueFlow' }).vm).toBe(flow)
    }
    await graph.setProps({ items: [done], version: 2 })
    await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBe('false'))
    expect(graph.get('.graph-canvas').attributes('style')).toContain('display: none')
    graph.findComponent(GraphBar).vm.$emit('update:showDone', true)
    await nextTick()
    await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBe('false'))
    await vi.waitFor(() => expect(graph.get('.graph-canvas').classes()).toContain('settled'))
    expect(graph.get('.graph-canvas').attributes('style') ?? '').not.toContain('display: none')
    expect(graph.findComponent({ name: 'VueFlow' }).vm).toBe(flow)
    expect(camera.mounts).toHaveBeenCalledTimes(1)
    graph.unmount()
  })

  it('keeps the camera when the field changes size, and pans only when that leaves nothing in sight', async () => {
    const graph = await openGraph()
    viewport.value = { x: 0, y: 0, zoom: 1 }
    dimensions.value = { width: 302, height: 300 }
    await flushPromises()
    await nextTick()
    expect(camera.setViewport).toHaveBeenCalledTimes(1)
    viewport.value = { x: 900, y: 0, zoom: 1 }
    dimensions.value = { width: 300, height: 300 }
    await vi.waitFor(() => expect(camera.setViewport).toHaveBeenCalledTimes(2))
    expect(camera.setViewport.mock.calls.at(-1)?.[0]).toMatchObject({ zoom: 1 })
    expect(graph.get('.graph-canvas').classes()).toContain('settled')
    expect(camera.mounts).toHaveBeenCalledTimes(1)
    graph.unmount()
  })

  it('exposes the whole graph, no destinationless camera jump, and resets only for scope changes', async () => {
    const graph = await openGraph()
    const buttons = graph.findAll('button')
    const whole = buttons.find((button) => button.text() === 'Fit whole graph')
    expect(whole).toBeDefined()
    // «Focus work» named no destination: it went to whichever workable item came first.
    expect(buttons.some((button) => button.text() === 'Focus work')).toBe(false)
    await whole?.trigger('click')
    // The key and the controls stand beside the flow, so the whole flow is field
    // and the framing leaves only its own air round the work.
    expect(camera.fitView).toHaveBeenCalledWith({
      padding: { top: '16px', bottom: '16px', left: '32px', right: '32px' },
      duration: 0,
      maxZoom: 1,
    })
    await graph.setProps({ scopeKind: 'none' })
    await vi.waitFor(() => expect(camera.setViewport).toHaveBeenCalledTimes(2))
    await graph.setProps({ space: 'space-2' })
    await vi.waitFor(() => expect(camera.setViewport).toHaveBeenCalledTimes(3))
    graph.unmount()
  })
})
