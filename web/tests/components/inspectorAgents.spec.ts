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
import { agentsByParent } from '@/widgets/work-item-inspector/utils/agentFacts.ts'

import type { Executor } from '@/shared/api/executorModel.ts'
import type { WorkItemAgent } from '@/shared/api/planningModel.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

// A group that can reach its session asks where a press on it would go. No server answers
// here, so the plan fails the way an unreachable one does, without going to the network.
vi.mock('@/shared/api/openPlanModel.ts', async (load) => {
  const actual = await load<typeof import('@/shared/api/openPlanModel.ts')>()
  return {
    ...actual,
    fetchOpenPlan: vi.fn(() =>
      Promise.reject(new actual.OpenPlanRequestError('request-failed', 'no server in a test')),
    ),
  }
})

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
    props: { agents },
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

  it('tells the exact link from the single-item claim, in both languages', () => {
    const cases: [Partial<WorkItemAgent>, string, string][] = [
      [{ link: 'exact' }, 'wrote to this item', 'писал в эту задачу'],
      [
        { link: 'claim', coordinator_items: 1 },
        "by the coordinator's claim",
        'по захвату координатора',
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

describe('the whole list', () => {
  const many = Array.from({ length: 94 }, (_, index) =>
    agent({ agent_id: `agent-${String(index).padStart(3, '0')}` }),
  )

  afterEach(() => {
    document.body.replaceChildren()
  })

  it('shows every row at once, in the order given, with no toggle', () => {
    const wrapper = mountAgents(many)
    const ids = wrapper.findAll('.agent-source .agent-id').map((id) => id.attributes('title'))
    expect(ids).toEqual(many.map((row) => row.agent_id))
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('Show all')
  })

  it('has no heading of its own, which the tab already is', () => {
    const wrapper = mountAgents(many.slice(0, 2))
    expect(wrapper.find('h3').exists()).toBe(false)
    expect(wrapper.find('.section-header-count').exists()).toBe(false)
  })

  it('follows a live read, the newest row first', async () => {
    const wrapper = mountAgents(many.slice(0, 2))
    await wrapper.setProps({ agents: [agent({ agent_id: 'the-newest' }), ...many.slice(0, 2)] })
    expect(wrapper.findAll('.agent')).toHaveLength(3)
    expect(wrapper.get('.agent-source .agent-id').attributes('title')).toBe('the-newest')
  })
})

function executorOf(session: string): Executor {
  return {
    session,
    agent: null,
    family: 'claude',
    state: 'live',
    opened_in: 'ide',
    opened_host: 'vscode',
  }
}
const NOBODY: Executor = {
  session: null,
  agent: null,
  family: '',
  state: 'none',
  opened_in: '',
  opened_host: '',
}

const ofParent = (id: string, session: string, executor: Executor | undefined) =>
  agent({ agent_id: id, session_id: session, executor })
const names = (groups: ReturnType<typeof agentsByParent>) =>
  groups.map((group) => group.agents.map((row) => row.agent_id))

describe('rows of one parent', () => {
  it('stand under the parent of the newest row first, and in the order they came', () => {
    const groups = agentsByParent([
      ofParent('a', 'one', executorOf('one')),
      ofParent('b', 'two', executorOf('two')),
      ofParent('c', 'one', executorOf('one')),
    ])
    expect(names(groups)).toEqual([['a', 'c'], ['b']])
    expect(groups.map((group) => group.session)).toEqual(['one', 'two'])
    expect(groups[0].executor?.session).toBe('one')
  })

  it('take the session a press reaches, over the one the row was recorded under', () => {
    const groups = agentsByParent([
      ofParent('a', 'recorded', executorOf('reached')),
      ofParent('b', 'reached', executorOf('reached')),
    ])
    expect(names(groups)).toEqual([['a', 'b']])
    expect(groups[0].session).toBe('reached')
  })

  it('with nothing to open still stand together, under no way to it', () => {
    const groups = agentsByParent([
      ofParent('a', 'one', NOBODY),
      ofParent('b', 'one', undefined),
      ofParent('c', 'two', NOBODY),
    ])
    expect(names(groups)).toEqual([['a', 'b'], ['c']])
    expect(groups.map((group) => group.executor)).toEqual([null, null])
  })

  it('a row that can reach the parent gives the way to the rows that cannot', () => {
    const groups = agentsByParent([
      ofParent('a', 'one', NOBODY),
      ofParent('b', 'one', executorOf('one')),
    ])
    expect(names(groups)).toEqual([['a', 'b']])
    expect(groups[0].executor?.session).toBe('one')
  })

  it('have nothing to tell apart when there is one parent, and say which when there are two', () => {
    const one = mountAgents([ofParent('a', 'first-session', executorOf('first-session'))])
    expect(one.find('.agent-group-id').exists()).toBe(false)
    const two = mountAgents([
      ofParent('a', 'first-session', executorOf('first-session')),
      ofParent('b', 'second-session', executorOf('second-session')),
    ])
    expect(two.findAll('.agent-group-id').map((id) => id.text())).toEqual(['first-se', 'second-s'])
    expect(two.findAll('.agent-group-id').map((id) => id.attributes('title'))).toEqual([
      'first-session',
      'second-session',
    ])
  })
})

const claimed = (id: string, items: number, session = 'one') =>
  agent({
    agent_id: id,
    session_id: session,
    executor: executorOf(session),
    link: 'claim',
    coordinator_items: items,
  })
const groupLines = (wrapper: ReturnType<typeof mountAgents>) =>
  wrapper.findAll('.agent-group-link').map((line) => line.text())

describe('the ambiguity, said once for its group', () => {
  it('says it once under the group head, and no row of the group says it again', () => {
    const wrapper = mountAgents([claimed('a', 13), claimed('b', 13), claimed('c', 13)])
    expect(groupLines(wrapper)).toEqual(['ambiguous: the coordinator held 13 items'])
    for (const index of [0, 1, 2]) expect(row(wrapper, index)).not.toContain('ambiguous')
  })

  it('says the same once in Russian, declined to its count', () => {
    const wrapper = mountAgents([claimed('a', 13), claimed('b', 13)], 'ru')
    expect(groupLines(wrapper)).toEqual(['неоднозначно: координатор держал 13\u{A0}задач'])
  })

  it.each([
    {
      case: 'a range of counts in English',
      counts: [13, 19],
      locale: 'en' as const,
      says: 'ambiguous: the coordinator held 13–19 items',
    },
    {
      case: 'a range declined by its upper bound in Russian',
      counts: [13, 19],
      locale: 'ru' as const,
      says: 'неоднозначно: координатор держал 13–19\u{A0}задач',
    },
    {
      case: 'an upper bound of 21 in Russian takes the singular form',
      counts: [13, 21],
      locale: 'ru' as const,
      says: 'неоднозначно: координатор держал 13–21\u{A0}задачу',
    },
  ])('gives $case', ({ counts, locale, says }) => {
    const wrapper = mountAgents(
      counts.map((items, index) => claimed(`agent-${index}`, items)),
      locale,
    )
    expect(groupLines(wrapper)).toEqual([says])
  })

  it('keeps the words of exact and single-item rows in a mixed group, and says the ambiguity once', () => {
    const wrapper = mountAgents([
      agent({ agent_id: 'exact', executor: executorOf('one'), link: 'exact' }),
      agent({
        agent_id: 'single',
        executor: executorOf('one'),
        link: 'claim',
        coordinator_items: 1,
      }),
      claimed('many', 19),
    ])
    expect(row(wrapper, 0)).toContain('wrote to this item')
    expect(row(wrapper, 1)).toContain("by the coordinator's claim")
    expect(row(wrapper, 2)).not.toContain('ambiguous')
    expect(groupLines(wrapper)).toEqual(['ambiguous: the coordinator held 19 items'])
  })

  it("keeps an ambiguous row's exact count in its tooltip and its accessible description", () => {
    const wrapper = mountAgents([claimed('a', 19)])
    const item = wrapper.get('.agent')
    expect(item.attributes('title')).toBe('ambiguous: the coordinator held 19 items')
    expect(item.attributes('aria-description')).toBe('ambiguous: the coordinator held 19 items')
  })

  it('says it under a group with no way to its parent too', () => {
    const wrapper = mountAgents([
      agent({
        agent_id: 'a',
        session_id: 'orphan',
        executor: NOBODY,
        link: 'claim',
        coordinator_items: 5,
      }),
    ])
    expect(wrapper.find('.agent-group-head').exists()).toBe(false)
    expect(groupLines(wrapper)).toEqual(['ambiguous: the coordinator held 5 items'])
  })

  it('says nothing where no row of the group is ambiguous', () => {
    const wrapper = mountAgents([
      agent({ agent_id: 'a', executor: executorOf('one'), link: 'exact' }),
      agent({ agent_id: 'b', executor: executorOf('one'), link: 'claim', coordinator_items: 1 }),
    ])
    expect(groupLines(wrapper)).toEqual([])
  })

  it('says it under each group that has one, and not under the rest', () => {
    const wrapper = mountAgents([
      claimed('a', 7, 'one'),
      agent({ agent_id: 'b', session_id: 'two', executor: executorOf('two'), link: 'exact' }),
    ])
    const groups = wrapper.findAll('.agent-group')
    expect(groups).toHaveLength(2)
    expect(groups[0].find('.agent-group-link').exists()).toBe(true)
    expect(groups[1].find('.agent-group-link').exists()).toBe(false)
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

describe('on Overview', () => {
  it.each([
    { case: 'an open item', closed: false },
    { case: 'a closed item', closed: true },
  ])('says nothing of them on $case', ({ closed }) => {
    const wrapper = overview([agent()], closed)
    expect(wrapper.find('.agents').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Check the export')
    expect(wrapper.text()).not.toContain('Agents')
  })
})
