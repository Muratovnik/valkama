/**
 * Live work as a card and a frame say it: a word and the session's sign on the
 * card, the one every screen draws for that state, of which only the working one
 * turns and only while the field moves, and how many items under a frame are
 * being worked on, beside the working sign.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import GraphFrame from '@/widgets/work-item-graph/components/GraphFrame.vue'
import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import { NO_EPIC_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { LiveWork, PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { i18n } from '@/shared/i18n/index.ts'

import { boardItem } from '../fixtures/board.ts'
import { hintOf } from '../support/hint.ts'

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

/** The card's sign: which one it is, and whether it is held still. */
function signOn(wrapper: ReturnType<typeof card>) {
  const svg = wrapper.get('.graph-live .session-sign')
  const sign = svg.classes().find((name) => name.startsWith('session-sign-'))
  return { sign: sign?.slice('session-sign-'.length), still: svg.classes().includes('still') }
}

describe('a card with live work', () => {
  it('says «working» and turns its sign while the field moves', () => {
    const wrapper = card({ state: 'working' })
    expect(wrapper.get('.graph-live-word').text()).toBe('working')
    expect(signOn(wrapper)).toEqual({ sign: 'working', still: false })
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toBe(
      'MAIN-7 Item 7 · In progress · Assigned to agent-1 · working',
    )
  })

  it('says «waiting» with the waiting sign when the turn is over', () => {
    const wrapper = card({ state: 'waiting', long: false, asks: false })
    expect(wrapper.get('.graph-live-word').text()).toBe('waiting')
    expect(signOn(wrapper).sign).toBe('waiting')
    expect(wrapper.get('.graph-live').attributes('data-live')).toBe('waiting')
  })

  it('says «спрашивает» with the asking sign for a session stopped mid-turn for a person', () => {
    i18n.global.locale.value = 'ru'
    const wrapper = card({ state: 'waiting', long: true, asks: true })
    expect(wrapper.get('.graph-live-word').text()).toBe('спрашивает')
    expect(signOn(wrapper).sign).toBe('asks')
    expect(wrapper.get('.graph-live').attributes('data-live')).toBe('asks')
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toBe(
      'MAIN-7 Item 7 · В работе · Закреплено за agent-1 · спрашивает',
    )
    i18n.global.locale.value = 'en'
    expect(card({ state: 'waiting', long: false, asks: true }).get('.graph-live-word').text()).toBe(
      'asking',
    )
  })

  it('says «у сессии» with the paused sign for an item its session holds but does not work on now', () => {
    i18n.global.locale.value = 'ru'
    const wrapper = card({ state: 'held' })
    expect(wrapper.get('.graph-live-word').text()).toBe('у сессии')
    expect(signOn(wrapper).sign).toBe('held')
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toBe(
      'MAIN-7 Item 7 · В работе · Закреплено за agent-1 · у сессии',
    )
  })

  it('says since when a silent session has said nothing, with the quiet sign, and never «ended»', () => {
    i18n.global.locale.value = 'ru'
    const wrapper = card(QUIET)
    const word = wrapper.get('.graph-live-word').text()
    // The day alone: silence is only called after a day, so the hour says nothing.
    expect(word).toBe('молчит с 02 нояб.')
    expect(signOn(wrapper).sign).toBe('quiet')
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

  it('draws one sign per state, each its own and all of one size', () => {
    const lives: LiveWork[] = [
      { state: 'working' },
      { state: 'waiting', long: false, asks: true },
      { state: 'waiting', long: false, asks: false },
      { state: 'held' },
      QUIET,
    ]
    const drawn = lives.map((live) => {
      const wrapper = card(live)
      const svg = wrapper.get('.graph-live .session-sign')
      return [signOn(wrapper).sign, svg.attributes('width'), svg.attributes('height')]
    })
    expect(drawn).toEqual([
      ['working', '14', '14'],
      ['asks', '14', '14'],
      ['waiting', '14', '14'],
      ['held', '14', '14'],
      ['quiet', '14', '14'],
    ])
  })

  it('holds even a running turn still when the field is paused', () => {
    const wrapper = card({ state: 'working' }, { still: true })
    expect(signOn(wrapper)).toEqual({ sign: 'working', still: true })
  })

  it('says nothing of live work on an item in Dev that no session is at', () => {
    const wrapper = card(null)
    expect(wrapper.find('.graph-live').exists()).toBe(false)
    expect(wrapper.find('.session-sign').exists()).toBe(false)
    expect(wrapper.get('.flow-node-card').attributes('aria-label')).toBe(
      'MAIN-7 Item 7 · In progress · Assigned to agent-1',
    )
  })

  it('zoomed out, draws no sign and keeps the word in its name and tooltip', () => {
    const wrapper = card({ state: 'working' }, { overview: true })
    expect(wrapper.find('.session-sign').exists()).toBe(false)
    const button = wrapper.get('.flow-node-card')
    expect(button.attributes('aria-label')).toContain('working')
    expect(hintOf(button)).toContain('working')
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
          header: 72,
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

  const sign = (still: boolean) => frame(1, still).get('.graph-frame-working .session-sign')

  it('draws the working sign, held still when the field does not move', () => {
    expect(sign(false).classes()).toEqual(expect.arrayContaining(['session-sign-working']))
    expect(sign(false).classes()).not.toContain('still')
    expect(sign(true).classes()).toContain('still')
  })
})
