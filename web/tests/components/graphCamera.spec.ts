import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import GraphView from '@/widgets/work-item-graph/components/GraphView.vue'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

const camera = vi.hoisted(() => ({
  fitView: vi.fn().mockResolvedValue(true),
  setViewport: vi.fn().mockResolvedValue(true),
}))

vi.mock('@vue-flow/core', async (original) => ({
  ...(await original<typeof import('@vue-flow/core')>()),
  useVueFlow: () => ({ ...camera, dimensions: { value: { width: 1200, height: 680 } } }),
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

async function openGraph() {
  const graph = mount(GraphView, {
    props: {
      items: [item],
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
        VueFlow: { name: 'VueFlow', template: '<div><slot /></div>' },
        Controls: { template: '<div><slot /></div>' },
        Background: true,
      },
    },
  })
  graph.findComponent({ name: 'VueFlow' }).vm.$emit('init')
  await flushPromises()
  return graph
}

describe('graph camera ownership', () => {
  beforeEach(() => vi.clearAllMocks())

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
    expect(camera.setViewport).toHaveBeenCalledTimes(1)
    graph.unmount()
  })

  it('exposes whole graph and focus actions and resets only for scope changes', async () => {
    const graph = await openGraph()
    const buttons = graph.findAll('button')
    const whole = buttons.find((button) => button.text() === 'Fit whole graph')
    const focus = buttons.find((button) => button.text() === 'Focus work')
    expect(whole).toBeDefined()
    expect(focus).toBeDefined()
    await whole?.trigger('click')
    expect(camera.fitView).toHaveBeenCalledWith({ padding: 0.18, duration: 0, maxZoom: 1 })
    await focus?.trigger('click')
    await flushPromises()
    expect(camera.setViewport).toHaveBeenCalledTimes(2)
    await graph.setProps({ scopeKind: 'none' })
    await flushPromises()
    expect(camera.setViewport).toHaveBeenCalledTimes(3)
    await graph.setProps({ space: 'space-2' })
    await flushPromises()
    expect(camera.setViewport).toHaveBeenCalledTimes(4)
    graph.unmount()
  })
})
