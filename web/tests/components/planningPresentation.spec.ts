import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'
import WorkItemTile from '@/widgets/work-item-views/components/WorkItemTile.vue'

import type { WorkItem, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

function workItem(overrides: Partial<WorkItemBrief> = {}): WorkItemBrief {
  return {
    work_item_id: '00000000-0000-4000-8000-000000000340',
    planning_space_id: '00000000-0000-4000-8000-000000000001',
    reference: 'QA-340',
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
    claim_state: null,
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
    claim: null,
    description: '',
    summary: null,
    summary_comment_id: null,
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
  it('distinguishes previous ownership in the list while retaining active assignees', async () => {
    const item = workItem({ claim_ref: 'claude' })
    const wrapper = mount(WorkItemList, {
      props: { items: [item], links: [] },
      global: { plugins: [i18n()] },
    })
    // The list draws its rows once it has measured its own width.
    await flushPromises()
    expect(wrapper.get('.list-claim').text()).toBe('claude')
    await wrapper.setProps({ items: [{ ...item, state: { ...item.state, is_terminal: true } }] })
    expect(wrapper.get('.list-claim').text()).toBe('Previously responsible: claude')
    expect(wrapper.get('.list-claim').attributes('title')).toBe('Previously responsible: claude')
  })

  it('marks a stale claim on the tile, and only while the work is open', async () => {
    const wrapper = mount(WorkItemTile, {
      props: { item: workItem({ claim_ref: 'codex', claim_state: 'live' }) },
      global: { plugins: [i18n()] },
    })
    expect(wrapper.find('[data-dimension="claim-lease"]').exists()).toBe(false)
    expect(wrapper.get('.tile-holder').text()).toBe('Responsible: codex')

    await wrapper.setProps({ item: workItem({ claim_ref: 'codex', claim_state: 'stale' }) })
    const mark = wrapper.get('[data-dimension="claim-lease"]')
    expect(mark.attributes('data-state')).toBe('stale')
    expect(mark.text()).toBe('Stale claim')
    expect(wrapper.get('.tile-holder').text()).toBe('Responsible: codex')

    await wrapper.setProps({
      item: workItem({
        claim_ref: 'codex',
        claim_state: 'stale',
        state: { ...workItem().state, is_terminal: true },
      }),
    })
    expect(wrapper.find('[data-dimension="claim-lease"]').exists()).toBe(false)
  })

  it('keeps priority readable without colouring the whole card', async () => {
    const wrapper = mount(WorkItemTile, {
      props: { item: workItem({ priority: 'urgent' }) },
      global: { plugins: [i18n()] },
    })

    expect(wrapper.get('.tile-priority').text()).toBe('Urgent')
    expect(wrapper.get('.work-item-tile').attributes('data-tone')).toBeUndefined()

    await wrapper.setProps({ item: workItem({ priority: 'high' }) })
    expect(wrapper.get('.tile-priority').text()).toBe('High')

    await wrapper.setProps({ item: workItem({ priority: 'medium' }) })
    expect(wrapper.get('.tile-priority').text()).toBe('Medium')
  })

  it('gives ready and active ownership precedence over the workflow marker', async () => {
    const wrapper = mount(GraphNodeCard, {
      props: { node: placedNode(), ready: false, recessed: false },
      global: { plugins: [i18n()], stubs: { Handle: true } },
    })

    expect(wrapper.get('.flow-node-card').attributes('data-tone')).toBe('danger')

    // Held work is moving, so it takes the hue of work under way, not of
    // finished work.
    await wrapper.setProps({ node: placedNode({ claim_ref: 'codex' }) })
    expect(wrapper.get('.flow-node-card').attributes('data-tone')).toBe('info')
    expect(wrapper.get('.flow-node-owner').text()).toContain('Assigned to')

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
    expect(wrapper.get('.flow-node-owner').text()).toContain('Previously responsible')
    expect(wrapper.get('.flow-node-owner').text()).not.toContain('Assigned to')
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
