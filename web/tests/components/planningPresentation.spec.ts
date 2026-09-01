import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'
import WorkItemTile from '@/widgets/work-item-views/components/WorkItemTile.vue'

import type { WorkItem, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

function workItem(overrides: Partial<WorkItemBrief> = {}): WorkItemBrief {
  return {
    work_item_id: '00000000-0000-4000-8000-000000000340',
    planning_space_id: '00000000-0000-4000-8000-000000000001',
    reference: 'EX-340',
    number: 340,
    title: 'Centralize semantic presentation',
    kind: 'task',
    priority: 'medium',
    state: {
      state_id: '00000000-0000-4000-8000-000000000002',
      key: 'blocked',
      name: 'Blocked',
      category: 'blocked',
      is_terminal: false,
    },
    claim_ref: '',
    parent_id: null,
    labels: [],
    source: '',
    checklist: [],
    revision: 1,
    created_at: '2026-08-30T10:00:00Z',
    updated_at: '2026-08-30T10:00:00Z',
    container: false,
    ready: false,
    comment_count: 0,
    ...overrides,
  }
}

function placedNode(overrides: Partial<PlacedNode> = {}): PlacedNode {
  return { ...workItem(), isolated: false, x: 0, y: 0, ...overrides }
}

function fullWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    ...workItem(),
    description: '',
    summary: null,
    links: [],
    refs: [],
    comments: [],
    events: [],
    ...overrides,
  }
}

function i18n() {
  return createI18n({ legacy: false, locale: 'en', messages })
}

describe('Planning semantic presentation', () => {
  it('renders priority through the shared work-item-priority presentation', async () => {
    const wrapper = mount(WorkItemTile, {
      props: { item: workItem({ priority: 'urgent' }) },
      global: { plugins: [i18n()] },
    })

    expect(wrapper.get('.work-item-tile').attributes('data-tone')).toBe('danger')

    await wrapper.setProps({ item: workItem({ priority: 'high' }) })
    expect(wrapper.get('.work-item-tile').attributes('data-tone')).toBe('warning')

    await wrapper.setProps({ item: workItem({ priority: 'medium' }) })
    expect(wrapper.get('.work-item-tile').attributes('data-tone')).toBe('neutral')
  })

  it('gives ready and active ownership precedence over the workflow marker', async () => {
    const wrapper = mount(GraphNodeCard, {
      props: { node: placedNode(), ready: false, recessed: false },
      global: { plugins: [i18n()] },
    })

    expect(wrapper.get('.flow-node-card').attributes('data-tone')).toBe('danger')

    await wrapper.setProps({ node: placedNode({ claim_ref: 'codex' }) })
    expect(wrapper.get('.flow-node-card').attributes('data-tone')).toBe('success')

    await wrapper.setProps({ ready: true })
    expect(wrapper.get('.flow-node-card').attributes('data-tone')).toBe('neutral')
    expect(wrapper.get('.flow-node-card').classes()).toContain('ready')

    await wrapper.setProps({
      ready: false,
      node: placedNode({
        claim_ref: 'codex',
        state: { ...workItem().state, is_terminal: true },
      }),
    })
    expect(wrapper.get('.flow-node-card').attributes('data-tone')).toBe('danger')
  })

  it('renders the inspector state from its shared workflow-state presentation', () => {
    const wrapper = mount(InspectorOverview, {
      props: {
        item: fullWorkItem(),
        resourceRef: {
          kind: 'planning-space',
          resource_id:
            'eyJkYXRhX3Njb3BlX2lkIjoiMDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwic3BhY2Vfa2V5IjoiQUcifQ',
        },
        writable: true,
      },
      global: {
        plugins: [i18n()],
        stubs: {
          InspectorReserved: true,
          InspectorSummary: true,
          SectionHeading: true,
          VIcon: true,
        },
      },
    })

    expect(wrapper.get('.fact-state').attributes('data-tone')).toBe('danger')
  })
})
