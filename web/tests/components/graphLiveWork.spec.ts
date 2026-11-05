/**
 * Live work as a card and a frame say it: a word and the working dots on the
 * card, which pulse only for a turn running while the field moves, and how
 * many items under a frame are being worked on.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import GraphFrame from '@/widgets/work-item-graph/components/GraphFrame.vue'
import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import { NO_EPIC_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { LiveWork, PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { i18n } from '@/shared/i18n/index.ts'

import { boardItem } from '../fixtures/board.ts'

afterEach(() => {
  document.body.innerHTML = ''
  i18n.global.locale.value = 'en'
})

const node = (overrides: Partial<PlacedNode> = {}): PlacedNode => ({
  ...boardItem(7, 'dev', { claim_ref: 'agent-1', claim_state: 'live' }),
  x: 0,
  y: 0,
  width: 264,
  height: 112,
  frameId: NO_EPIC_FRAME,
  ...overrides,
})

function card(live: LiveWork | null, options: { overview?: boolean; still?: boolean } = {}) {
  return mount(GraphNodeCard, {
    attachTo: document.body,
    props: { node: node(), ready: false, recessed: false, live, ...options },
    global: { plugins: [i18n], stubs: { Handle: true } },
  })
}

const QUIET: LiveWork = { state: 'quiet', quiet_since: '2026-11-02T08:00:00Z' }

describe('a card with live work', () => {
  it('says «working» and pulses its dots while the field moves', () => {
    const wrapper = card({ state: 'working' })
    expect(wrapper.get('.graph-live-word').text()).toBe('working')
    expect(wrapper.get('.graph-live .work-dots').classes()).not.toContain('still')
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toBe(
      'MAIN-7 Item 7 · Dev · Assigned to agent-1 · working',
    )
  })

  it('says «waiting» with still dots when the turn is over', () => {
    const wrapper = card({ state: 'waiting' })
    expect(wrapper.get('.graph-live-word').text()).toBe('waiting')
    expect(wrapper.get('.graph-live .work-dots').classes()).toContain('still')
  })

  it('says «у сессии» with still dots for an item its session holds but does not work on now', () => {
    i18n.global.locale.value = 'ru'
    const wrapper = card({ state: 'held' })
    expect(wrapper.get('.graph-live-word').text()).toBe('у сессии')
    expect(wrapper.get('.graph-live .work-dots').classes()).toContain('still')
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toBe(
      'MAIN-7 Item 7 · Dev · Закреплено за agent-1 · у сессии',
    )
  })

  it('says since when a silent session has said nothing, still, and never «ended»', () => {
    i18n.global.locale.value = 'ru'
    const wrapper = card(QUIET)
    const word = wrapper.get('.graph-live-word').text()
    // The day alone: silence is only called after a day, so the hour says nothing.
    expect(word).toBe('молчит с 02 нояб.')
    expect(wrapper.get('.graph-live .work-dots').classes()).toContain('still')
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toContain(word)
  })

  it('drops «Claimed by» from the foot beside live work, and keeps it in the name', () => {
    const wrapper = card({ state: 'working' })
    expect(wrapper.find('.flow-node-owner-state').exists()).toBe(false)
    expect(wrapper.get('.flow-node-owner-name').text()).toBe('agent-1')
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toContain('Assigned to agent-1')
    // Without live work the foot still says who holds it and how.
    expect(card(null).get('.flow-node-owner-state').text()).toBe('Assigned to')
  })

  it('holds even a running turn still when the field is paused', () => {
    const wrapper = card({ state: 'working' }, { still: true })
    expect(wrapper.get('.graph-live .work-dots').classes()).toContain('still')
  })

  it('says nothing of live work on an item in Dev that no session is at', () => {
    const wrapper = card(null)
    expect(wrapper.find('.graph-live').exists()).toBe(false)
    expect(wrapper.find('.work-dots').exists()).toBe(false)
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toBe(
      'MAIN-7 Item 7 · Dev · Assigned to agent-1',
    )
  })

  it('zoomed out, draws no dots and keeps the word in its name and tooltip', () => {
    const wrapper = card({ state: 'working' }, { overview: true })
    expect(wrapper.find('.work-dots').exists()).toBe(false)
    const button = wrapper.get('.flow-node-card')
    expect(button.attributes('aria-label')).toContain('working')
    expect(button.attributes('title')).toContain('working')
  })
})

describe('a frame with live work under it', () => {
  const EPIC = boardItem(12, 'dev', { kind: 'epic', container: true, title: 'Frames' })
  const frame = (working: number, still = false) =>
    mount(GraphFrame, {
      attachTo: document.body,
      props: {
        frame: {
          id: EPIC.work_item_id,
          epic: EPIC,
          parentId: null,
          folded: true,
          foldable: true,
          x: 0,
          y: 0,
          width: 288,
          height: 72,
          progress: { done: 1, review: 0, active: 2, blocked: 0, ahead: 0, total: 3 },
          members: [],
        },
        working,
        still,
      },
      global: { plugins: [i18n], stubs: { Handle: true } },
    })

  it('says how many items an agent is working on, in the open target’s name too', () => {
    i18n.global.locale.value = 'ru'
    const wrapper = frame(2)
    expect(wrapper.get('.graph-frame-working').text().replaceAll(/\s+/gu, ' ')).toBe('2 работают')
    expect(wrapper.get('button.graph-frame-open').attributes('aria-label')).toBe(
      'Эпик MAIN-12 «Frames» · 1 из 3 выполнено · 2 в работе · 2 открытых внутри · 2 работают',
    )
  })

  it('writes nothing of it while nothing under it moves', () => {
    expect(frame(0).find('.graph-frame-working').exists()).toBe(false)
  })

  it('holds its dots still when the field does not move', () => {
    expect(frame(1, true).get('.graph-frame-working .work-dots').classes()).toContain('still')
  })
})
