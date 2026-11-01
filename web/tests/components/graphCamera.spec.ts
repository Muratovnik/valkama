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

async function openGraph(items = [item]) {
  const graph = mount(GraphView, {
    props: {
      items,
      edges: [],
      epicId: null,
      open: true,
      scopeKind: 'all',
      space: 'space-1',
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

  it('frames a new narrowing of the items afresh, and still not a refresh of the same one', async () => {
    const other = { ...item, work_item_id: 'work-2', reference: 'TEST-2', number: 2 }
    const graph = await openGraph([item, other])
    expect(camera.setViewport).toHaveBeenCalledTimes(1)
    // The queue or the search narrowed the items: the new layout is framed.
    await graph.setProps({ items: [other], filter: '["ready","test-2"]' })
    await vi.waitFor(() => expect(camera.setViewport).toHaveBeenCalledTimes(2))
    // The same narrowing refreshed by the stream: the camera stays.
    await graph.setProps({ items: [{ ...other, revision: 1 }], version: 2 })
    await flushPromises()
    await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBe('false'))
    expect(camera.setViewport).toHaveBeenCalledTimes(2)
    graph.unmount()
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

  it('reframes readable work when the actual viewport changes size', async () => {
    const graph = await openGraph()
    const previous = camera.setViewport.mock.calls.at(-1)?.[0]
    dimensions.value = { width: 302, height: 300 }
    await vi.waitFor(() => expect(camera.setViewport).toHaveBeenCalledTimes(2))
    expect(camera.setViewport.mock.calls.at(-1)?.[0]).not.toEqual(previous)
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
