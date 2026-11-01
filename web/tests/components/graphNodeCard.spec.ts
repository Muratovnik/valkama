/**
 * A graph node's facets, as the reader meets them: workable said quietly in
 * the state's place rather than in the boldest ink on the card, what a node
 * waits on named, the priority and kind as glyphs before the reference, and a
 * chain edge in the same hue as the state's dot.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { chainGroup } from '@/shared/api/planningChainGroups.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { boardItem, boardState } from '../fixtures/board.ts'
import type { BoardStateKey } from '../fixtures/board.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

const node = (
  state: BoardStateKey = 'backlog',
  overrides: Partial<PlacedNode> = {},
): PlacedNode => ({
  ...boardItem(4, state),
  isolated: false,
  x: 0,
  y: 0,
  ...overrides,
})

function card(props: Record<string, unknown> & { node: PlacedNode }) {
  return mount(GraphNodeCard, {
    attachTo: document.body,
    props: { ready: false, recessed: false, ...props },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })],
      stubs: { Handle: true },
    },
  })
}

describe('a graph node', () => {
  it('says workable quietly, in place of its state, and in no heavier ink', () => {
    const wrapper = card({ node: node('backlog', { ready: true }), ready: true })
    const state = wrapper.get('.flow-node-state')
    expect(state.text()).toBe('Workable')
    expect(state.find('.semantic-state').exists()).toBe(false)
    const mark = state.get('[data-facet="readiness"]')
    expect(mark.classes()).toContain('quiet')
    expect(mark.attributes('data-tone')).toBe('neutral')
    // No rule lifts the readiness above the card's own text.
    expect(wrapper.html()).not.toMatch(/font-weight/)
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toContain('Workable')
  })

  it('names what it waits on, and keeps its state word otherwise', () => {
    const waiting = card({ node: node('todo'), waitingOn: 'OTH-7' })
    const mark = waiting.get('.flow-node-state [data-facet="readiness"]')
    expect(mark.text()).toBe('Waiting on OTH-7')
    expect(mark.attributes('data-tone')).toBe('danger')
    expect(waiting.get('.flow-node-card').attributes('aria-label')).toContain('Waiting on OTH-7')

    const plain = card({ node: node('dev') })
    expect(plain.get('.flow-node-state .semantic-state').text()).toBe('Dev')
  })

  it('leads its reference with the kind and ends its foot with high or urgent, as glyphs that do not filter', () => {
    const wrapper = card({
      node: node('dev', { priority: 'urgent', kind: 'bug', claim_ref: 'codex' }),
    })
    const facets = (selector: string) =>
      wrapper.findAll(`${selector} [data-facet]`).map((mark) => mark.attributes('data-facet'))
    expect(facets('.flow-node-meta')).toEqual(['kind'])
    expect(facets('.flow-node-owner')).toEqual(['priority'])
    expect(wrapper.get('.flow-node-owner').text()).toContain('codex')
    // The card is the one button; nothing inside it is another control.
    expect(wrapper.findAll('button')).toHaveLength(1)
    const quiet = card({ node: node('dev', { priority: 'low', kind: 'task' }) })
    expect(quiet.findAll('[data-facet="kind"], [data-facet="priority"]')).toHaveLength(0)
    expect(quiet.find('.flow-node-owner').exists()).toBe(false)
  })

  it('names who held finished work although the close ended the claim', () => {
    const closed = card({
      node: node('done', { claim_ref: '', last_claim_ref: 'claude (session 5937aa01-1234-4c00)' }),
    })
    const owner = closed.get('.flow-node-owner')
    expect(owner.get('.flow-node-owner-state').text()).toBe('Previously responsible')
    expect(owner.get('.flow-node-owner-name').text()).toBe('claude · 5937aa01-1234')
    const unheld = card({ node: node('done', { claim_ref: '', last_claim_ref: null }) })
    expect(unheld.find('.flow-node-owner').exists()).toBe(false)
  })

  it('draws its chain edge in the hue of its state’s dot', () => {
    for (const state of ['backlog', 'todo', 'dev', 'done'] as const) {
      // Not workable, so the state itself is what the node says.
      const item = node(state, { ready: false })
      const wrapper = card({ node: item, chainGroup: chainGroup(item) })
      expect(wrapper.get('.flow-node-chain').attributes('data-tone'), state).toBe(
        wrapper.get('.flow-node-state .semantic-state').attributes('data-tone'),
      )
    }
    const review = node('dev', {
      state: { ...boardState('dev'), key: 'review', name: 'Review', category: 'review' },
    })
    const blocked = node('dev', {
      state: { ...boardState('dev'), key: 'blocked', name: 'Blocked', category: 'blocked' },
    })
    for (const item of [review, blocked]) {
      const wrapper = card({ node: item, chainGroup: chainGroup(item) })
      expect(wrapper.get('.flow-node-chain').attributes('data-tone')).toBe(
        wrapper.get('.flow-node-state .semantic-state').attributes('data-tone'),
      )
    }
  })
})
