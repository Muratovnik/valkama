/**
 * What the card says about the agents on an item, and what it refuses to say.
 *
 * The record cannot prove an agent is alive and does not know how much remains, so
 * these cases read the words a person reads, in both languages: no row says it is
 * working, «ended» needs a recorded end, and an ambiguous link says so.
 */
import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorAgents from '@/widgets/work-item-inspector/components/InspectorAgents.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'

import type { WorkItemAgent } from '@/shared/api/planningModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

// happy-dom draws nothing, so nothing is under way.
document.getAnimations = () => []

const NOW = '2026-11-02T12:00:00Z'

function agent(overrides: Partial<WorkItemAgent> = {}): WorkItemAgent {
  return {
    agent_id: 'a4d2c8f1e0b3a297',
    session_id: 'parent',
    agent_type: 'Explore',
    label: 'Check the export',
    started_at: '2026-11-02T11:00:00Z',
    last_activity_at: '2026-11-02T11:29:00Z',
    ended_at: null,
    steps: [],
    link: 'exact',
    coordinator_items: null,
    ...overrides,
  }
}

function mountAgents(agents: WorkItemAgent[], locale: 'en' | 'ru' = 'en') {
  const i18n = createI18n({
    legacy: false,
    locale,
    messages,
    pluralRules,
    datetimeFormats: {
      en: {
        clock: { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' },
        day: { month: 'short', day: '2-digit', timeZone: 'UTC' },
        activity: { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' },
      },
      ru: {
        clock: { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' },
        day: { month: 'short', day: '2-digit', timeZone: 'UTC' },
        activity: { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' },
      },
    },
  })
  return mount(InspectorAgents, {
    attachTo: document.body,
    global: { plugins: [i18n] },
    props: { agents, identity: 'item' },
  })
}

const row = (wrapper: ReturnType<typeof mountAgents>, index = 0) =>
  wrapper
    .findAll('.agent')
    [index].text()
    .replaceAll(/[ \t\n]+/gu, ' ')

describe('a row', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('says what it is for, when it started, its last sign and the span between', () => {
    const text = row(mountAgents([agent()]))
    expect(text).toContain('Check the export')
    expect(text).toContain('Started 11:00')
    expect(text).toContain('last activity 11:29, 31\u{A0}min ago')
    expect(text).toContain('29\u{A0}min from the start')
    expect(text).toContain('Explore')
    expect(text).toContain('a4d2c8f1')
    expect(text).toContain('wrote to this item')
  })

  it('never says an agent is working, or how much is left', () => {
    for (const shape of [agent(), agent({ last_activity_at: agent().started_at })]) {
      const text = row(mountAgents([shape])).toLowerCase()
      for (const claim of ['working', 'running', 'alive', 'remaining', 'left', 'eta']) {
        expect(text).not.toContain(claim)
      }
    }
  })

  it('says ended only with a recorded end', () => {
    expect(row(mountAgents([agent()]))).not.toContain('ended')
    const text = row(
      mountAgents([
        agent({ last_activity_at: '2026-11-02T11:40:00Z', ended_at: '2026-11-02T11:40:00Z' }),
      ]),
    )
    expect(text).toContain('ended 11:40')
    expect(text).toContain('40\u{A0}min from the start')
    expect(text).not.toContain('last activity')
  })

  it('an agent silent since its start says so rather than a span of nothing', () => {
    const text = row(mountAgents([agent({ last_activity_at: '2026-11-02T11:00:00Z' })]))
    expect(text).toContain('Started 11:00, 1\u{A0}h ago')
    expect(text).toContain('no sign of it since')
    expect(text).not.toContain('from the start')
  })

  it('a row with no label stands on its type, and on its id when it has no type', () => {
    const typed = mountAgents([agent({ label: '' })])
    expect(typed.get('.agent-name').text()).toBe('Explore')
    expect(typed.get('.agent-source').text()).toContain('a4d2c8f1')
    expect(typed.get('.agent-source').text()).not.toContain('Explore')

    const bare = mountAgents([agent({ label: '', agent_type: '' })])
    expect(bare.get('.agent-name').text()).toBe('a4d2c8f1')
    expect(bare.get('.agent-source').text()).not.toContain('a4d2c8f1')
  })

  it('names the step it holds', () => {
    const text = row(
      mountAgents([
        agent({ steps: [{ id: '00000000-0000-4000-8000-000000000001', text: 'Write the hook' }] }),
      ]),
    )
    expect(text).toContain('Holds step: Write the hook')
  })

  it('a label is text and never markup', () => {
    const wrapper = mountAgents([agent({ label: '<img src=x onerror=alert(1)>' })])
    expect(wrapper.find('.agent img').exists()).toBe(false)
  })

  it('tells the three links apart, in both languages', () => {
    const cases: [Partial<WorkItemAgent>, string, string][] = [
      [{ link: 'exact' }, 'wrote to this item', 'писал в эту задачу'],
      [
        { link: 'claim', coordinator_items: 1 },
        "by the coordinator's claim",
        'по захвату координатора',
      ],
      [
        { link: 'claim', coordinator_items: 3 },
        'ambiguous: the coordinator held 3 items',
        'неоднозначно: координатор держал 3\u{A0}задачи',
      ],
      [
        { link: 'claim', coordinator_items: 20 },
        'ambiguous: the coordinator held 20 items',
        'неоднозначно: координатор держал 20\u{A0}задач',
      ],
    ]
    for (const [shape, english, russian] of cases) {
      expect(row(mountAgents([agent(shape)], 'en'))).toContain(english)
      expect(row(mountAgents([agent(shape)], 'ru'))).toContain(russian)
    }
  })

  it('an unambiguous claim does not call itself ambiguous', () => {
    const text = row(mountAgents([agent({ link: 'claim', coordinator_items: 1 })]))
    expect(text).not.toContain('ambiguous')
  })

  it('shortens a day as the rest of the catalog does, in both languages', () => {
    const shape = agent({
      started_at: '2026-10-31T12:00:00Z',
      last_activity_at: '2026-11-01T12:00:00Z',
    })
    expect(row(mountAgents([shape], 'ru'))).toContain('1\u{A0}дн. назад')
    expect(row(mountAgents([shape], 'en'))).toContain('1\u{A0}d ago')
  })

  it('its age moves with the clock while the row has no end, and fetches nothing', async () => {
    const fetching = vi.spyOn(globalThis, 'fetch')
    const wrapper = mountAgents([agent()])
    expect(row(wrapper)).toContain('31\u{A0}min ago')
    vi.advanceTimersByTime(10 * 60_000)
    await nextTick()
    expect(row(wrapper)).toContain('41\u{A0}min ago')
    expect(fetching).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a list of ended agents keeps no clock', () => {
    mountAgents([agent({ ended_at: '2026-11-02T11:40:00Z' })])
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('a long list', () => {
  const many = Array.from({ length: 94 }, (_, index) =>
    agent({ agent_id: `agent-${String(index).padStart(3, '0')}` }),
  )

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('shows the first rows in the order given and counts them all', () => {
    const wrapper = mountAgents(many)
    expect(wrapper.findAll('.agent')).toHaveLength(3)
    expect(wrapper.findAll('.agent-source .agent-id').map((id) => id.text())).toEqual([
      'agent-00',
      'agent-00',
      'agent-00',
    ])
    expect(wrapper.get('.section-header-count').text()).toBe('94')
    expect(wrapper.get('.agents-more').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('.agents-more').text()).toBe('Show all · 94')
  })

  it('opens onto the first row it revealed and closes back onto the toggle', async () => {
    const wrapper = mountAgents(many)
    await wrapper.get('.agents-more').trigger('click')
    await nextTick()
    const rows = wrapper.findAll('.agent')
    expect(rows).toHaveLength(94)
    expect(document.activeElement).toBe(rows[3].element)
    expect(wrapper.get('.agents-more').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.agents-more').attributes('aria-controls')).toBe(
      wrapper.get('.agent-list').attributes('id'),
    )
    await wrapper.get('.agents-more').trigger('click')
    await nextTick()
    expect(wrapper.findAll('.agent')).toHaveLength(3)
    expect(document.activeElement).toBe(wrapper.get('.agents-more').element)
  })

  it('stays open through a live read and folds for another item', async () => {
    const wrapper = mountAgents(many)
    await wrapper.get('.agents-more').trigger('click')
    await wrapper.setProps({ agents: [...many] })
    expect(wrapper.findAll('.agent')).toHaveLength(94)
    await wrapper.setProps({ identity: 'another' })
    expect(wrapper.findAll('.agent')).toHaveLength(3)
  })

  it('a list one row past the fold stands whole, with no toggle for one row', () => {
    for (const count of [3, 4]) {
      const wrapper = mountAgents(many.slice(0, count))
      expect(wrapper.findAll('.agent')).toHaveLength(count)
      expect(wrapper.find('.agents-more').exists()).toBe(false)
    }
    expect(mountAgents(many.slice(0, 5)).findAll('.agent')).toHaveLength(3)
  })
})

function overview(agents: WorkItemAgent[] | undefined, closed = false) {
  const i18n = createI18n({ legacy: false, locale: 'en', messages, pluralRules })
  const item = workItemFixture('Item', 1)
  const finished = {
    state: { ...item.state, is_terminal: true },
    summary: { done: 'Shipped', next: '' },
  }
  return mount(InspectorOverview, {
    global: { plugins: [i18n], stubs: { InspectorChain: true } },
    props: { item: { ...item, agents, ...(closed ? finished : {}) }, writable: false },
  })
}

/** Whether the first thing stands before the second in the card's reading order. */
function standsBefore(wrapper: ReturnType<typeof overview>, first: string, second: string) {
  const position = wrapper.get(first).element.compareDocumentPosition(wrapper.get(second).element)
  return Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)
}

describe('on the card', () => {
  it('has no section without agents', () => {
    expect(overview(undefined).find('.agents').exists()).toBe(false)
    expect(overview([]).find('.agents').exists()).toBe(false)
    expect(overview(undefined).text()).not.toContain('Agents')
  })

  it('has the section with one', () => {
    expect(overview([agent()]).get('.agents').text()).toContain('Agents')
  })

  it('stands over the description of an open item', () => {
    expect(standsBefore(overview([agent()]), '.agents', '.description-section')).toBe(true)
  })

  it('stands once, under the outcome, on a closed item', () => {
    const wrapper = overview([agent()], true)
    expect(wrapper.findAll('.agents')).toHaveLength(1)
    expect(standsBefore(wrapper, '.description-section', '.outcome')).toBe(true)
    expect(standsBefore(wrapper, '.outcome', '.agents')).toBe(true)
  })
})
