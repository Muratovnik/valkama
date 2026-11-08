import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import InspectorFacts from '@/widgets/work-item-inspector/components/InspectorFacts.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'
import WorkItemTile from '@/widgets/work-item-views/components/WorkItemTile.vue'

import type { WorkItem, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { hintOf } from '../support/hint.ts'

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
  return { ...workItem(), x: 0, y: 0, width: 264, height: 112, frameId: 'none', ...overrides }
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
    expect(hintOf(wrapper.get('.list-claim'))).toBe('Previously responsible: claude')
  })

  it('says the holder and a stale claim with one glyph, and only while the work is open', async () => {
    const wrapper = mount(WorkItemTile, {
      props: { item: workItem({ claim_ref: 'codex', claim_state: 'live' }) },
      global: { plugins: [i18n()] },
    })
    // A glyph, its words the hover and the name: no name and no «Stale claim» on the sheet.
    const holder = () => wrapper.get('.tile-facts [data-facet="holder"]')
    expect(holder().find('svg').exists()).toBe(true)
    expect(holder().get('.facet-word').classes()).toContain('facet-word-hidden')
    expect(holder().text()).toBe('Held by codex')
    expect(hintOf(holder())).toBe('Held by codex')
    expect(holder().attributes('data-tone')).toBe('neutral')
    expect(wrapper.find('[data-dimension="claim-lease"]').exists()).toBe(false)

    await wrapper.setProps({ item: workItem({ claim_ref: 'codex', claim_state: 'stale' }) })
    expect(holder().text()).toBe('Held by codex — the claim is stale')
    expect(hintOf(holder())).toBe('Held by codex — the claim is stale')
    expect(holder().attributes('data-tone')).toBe('warning')
    expect(wrapper.find('[data-dimension="claim-lease"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Stale claim')

    await wrapper.setProps({
      item: workItem({
        claim_ref: 'codex',
        claim_state: 'stale',
        state: { ...workItem().state, is_terminal: true },
      }),
    })
    // Finished work: the claim is history, so the holder is not printed.
    expect(wrapper.find('[data-facet="holder"]').exists()).toBe(false)
  })

  it('prints kind and priority as glyphs around the reference, only when they differ from the norm', async () => {
    const wrapper = mount(WorkItemTile, {
      attachTo: document.body,
      props: { item: workItem({ priority: 'urgent', kind: 'improvement' }) },
      global: { plugins: [i18n()] },
    })
    const priority = wrapper.get('.tile-line [data-facet="priority"]')
    expect(priority.attributes('data-tone')).toBe('danger')
    expect(priority.find('svg').exists()).toBe(true)
    // The word is the glyph's name, not text on the sheet.
    expect(priority.get('.facet-word').classes()).toContain('facet-word-hidden')
    expect(priority.get('.facet-word').text()).toBe('Urgent')
    const kind = wrapper.get('.tile-line [data-facet="kind"]')
    expect(kind.get('.facet-word').classes()).toContain('facet-word-hidden')
    expect(kind.get('.facet-word').text()).toBe('Improvement')
    expect(wrapper.get('.work-item-tile').attributes('data-tone')).toBeUndefined()
    // Read, not pressed: the glyphs are no buttons, and the one Tab stop says them.
    expect(wrapper.get('.tile-line').findAll('button')).toHaveLength(0)
    const described = wrapper.get('.tile-open').attributes('aria-describedby') ?? ''
    expect(described.split(' ')).toContain(wrapper.get('.tile-lead').attributes('id'))
    // The kind, the reference, the priority: the order every surface reads an item in.
    const head = wrapper
      .findAll('.tile-lead [data-facet], .tile-lead .tile-reference')
      .map((part) => part.attributes('data-facet') ?? 'reference')
    expect(head).toEqual(['kind', 'reference', 'priority'])

    await wrapper.setProps({ item: workItem({ priority: 'high' }) })
    expect(wrapper.get('[data-facet="priority"]').attributes('data-tone')).toBe('warning')
    expect(wrapper.find('[data-facet="kind"]').exists()).toBe(false)

    // Medium and a plain task are the norm: nothing on the line but the reference.
    await wrapper.setProps({ item: workItem({ priority: 'medium' }) })
    expect(wrapper.find('.tile-lead [data-facet]').exists()).toBe(false)
    expect(wrapper.get('.tile-lead').attributes('id')).toBeUndefined()
    expect(wrapper.get('.tile-line').text()).toBe('QA-340')
    wrapper.unmount()
  })

  it('names an open blocker on the tile and never says the item is workable', async () => {
    const wrapper = mount(WorkItemTile, {
      props: {
        item: workItem({ ready: true, state: { ...workItem().state, category: 'backlog' } }),
      },
      global: { plugins: [i18n()] },
    })
    expect(wrapper.text()).not.toMatch(/workable/iu)
    expect(wrapper.find('[data-facet="readiness"]').exists()).toBe(false)

    await wrapper.setProps({ waitingOn: 'QA-12' })
    const waiting = wrapper.get('.tile-line [data-facet="readiness"]')
    // The line draws the glyph and the reference; the sentence is the name.
    expect(waiting.get('.facet-word').text()).toBe('QA-12')
    expect(waiting.get('.facet-word-hidden').text()).toBe('Waiting on QA-12')
    expect(waiting.attributes('data-tone')).toBe('danger')
    // Folded short of room, the glyph still tells the pointer what it stands for.
    expect(hintOf(waiting)).toBe('Waiting on QA-12')
    // The open target names the item and is described by what stops it.
    const open = wrapper.get('.tile-open')
    const described = open.attributes('aria-describedby') ?? ''
    expect(described.split(' ')).toContain(wrapper.get('.tile-exceptions').attributes('id'))
    expect(open.text()).toContain('QA-340')
    expect(hintOf(open)).toBe('Centralize semantic presentation')
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
    // With no way to move it, the state is the plain mark the board draws.
    const wrapper = mount(InspectorFacts, {
      props: { item: fullWorkItem(), workflow: null, busy: false, writable: true },
      global: { plugins: [i18n()], stubs: { VIcon: true } },
    })

    expect(wrapper.get('.card-state').attributes('data-tone')).toBe('danger')
  })
})
