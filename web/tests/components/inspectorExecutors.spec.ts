/**
 * Where the card puts the way to a session: its holder in the head, on finished work
 * too, and each agent's parent. The button's own behavior is `openAction.spec.ts`; here
 * it is who a card names, what it opens, and that what stood around the holder stayed.
 */
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InspectorAgents from '@/widgets/work-item-inspector/components/InspectorAgents.vue'
import InspectorFacts from '@/widgets/work-item-inspector/components/InspectorFacts.vue'

import OpenAction from '@/features/session-open/OpenAction.vue'

import type { Executor } from '@/shared/api/executorModel.ts'
import type { WorkItem, WorkItemAgent } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

const SESSION = '6f1c2a8e-0000-4000-8000-000000000001'
const executor: Executor = {
  session: SESSION,
  agent: null,
  opened_in: 'ide',
  opened_host: 'vscode',
  family: 'claude',
  state: 'ended',
}
const nobody: Executor = {
  session: null,
  agent: null,
  opened_in: '',
  opened_host: '',
  family: '',
  state: 'none',
}

const claim = {
  holder: `claude (session ${SESSION})`,
  state: 'live',
  session_id: SESSION,
  agent_id: null,
  source: 'hook',
  acquired_at: null,
  last_seen: null,
  expires_at: null,
} as const

function plugins() {
  const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })
  return [createPinia(), i18n]
}

function facts(item: WorkItem) {
  return mount(InspectorFacts, {
    props: { busy: false, item, workflow: null, writable: false },
    global: { plugins: plugins() },
  })
}

function closed(item: WorkItem): WorkItem {
  return { ...item, state: { ...item.state, category: 'completed', is_terminal: true } }
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the holder in the head', () => {
  it('is a button to the session of the claim, named as a holder is', async () => {
    const wrapper = facts({
      ...workItemFixture('Held', 1),
      claim_ref: claim.holder,
      claim: { ...claim, executor },
    })
    await flushPromises()
    const action = wrapper.getComponent(OpenAction)
    expect(action.props('session')).toBe(SESSION)
    expect(wrapper.get('button.open-action').attributes('aria-label')).toBe(
      'Open session claude · 6f1c2a8e-0000 in VS Code',
    )
  })

  it('keeps the dot that says nobody is behind a stale lease beside the button', () => {
    const wrapper = facts({
      ...workItemFixture('Stale', 1),
      claim_ref: claim.holder,
      claim_state: 'stale',
      claim: { ...claim, state: 'stale', executor },
    })
    expect(wrapper.find('button.open-action').exists()).toBe(true)
    expect(wrapper.find('.card-holder .card-holder-stale').exists()).toBe(true)
  })

  it('stays text where the claim has no session, as a person’s has none', () => {
    const wrapper = facts({
      ...workItemFixture('Mine', 1),
      claim_ref: 'the owner',
      claim: { ...claim, holder: 'the owner', session_id: null, executor: nobody },
    })
    expect(wrapper.find('button.open-action').exists()).toBe(false)
    expect(wrapper.get('.card-holder').text()).toContain('the owner')
  })

  it('on finished work is whoever last held it, said as history', async () => {
    const wrapper = facts(
      closed({
        ...workItemFixture('Done', 1),
        last_claim_ref: claim.holder,
        last_claim_executor: executor,
      }),
    )
    await flushPromises()
    expect(wrapper.get('.card-holder-label').text()).toBe('Previously responsible')
    expect(wrapper.getComponent(OpenAction).props('session')).toBe(SESSION)
  })

  it('on finished work with nobody to reach stays the sentence it was', () => {
    const wrapper = facts(
      closed({
        ...workItemFixture('Done', 1),
        last_claim_ref: 'the owner',
        last_claim_executor: nobody,
      }),
    )
    expect(wrapper.find('button.open-action').exists()).toBe(false)
    expect(wrapper.get('.card-holder-label').text()).toBe('Previously responsible')
    expect(wrapper.get('.card-holder-name').text()).toBe('the owner')
  })
})

describe('an agent on the card', () => {
  const agent: WorkItemAgent = {
    agent_id: 'a4d2c8f1e0b3a297',
    session_id: SESSION,
    agent_type: 'general-purpose',
    label: '',
    started_at: '2026-08-13T08:00:00Z',
    last_activity_at: '2026-08-13T08:29:00Z',
    ended_at: null,
    steps: [],
    link: 'exact',
    coordinator_items: null,
  }

  function agents(listed: WorkItemAgent[]) {
    return mount(InspectorAgents, {
      props: { agents: listed, identity: 'item' },
      global: { plugins: plugins() },
    })
  }

  it('opens its parent session, and says that is where it shows', async () => {
    const wrapper = agents([{ ...agent, executor: { ...executor, agent: agent.agent_id } }])
    await flushPromises()
    const button = wrapper.get('button.open-action')
    expect(button.attributes('aria-label')).toBe('Open the parent session in VS Code')
    expect(button.attributes('title')).toContain('The agent’s progress shows in its parent session')
    expect(wrapper.getComponent(OpenAction).props('session')).toBe(SESSION)
  })

  it('offers nothing where nothing can be opened', () => {
    const wrapper = agents([{ ...agent, executor: nobody }])
    expect(wrapper.find('button.open-action').exists()).toBe(false)
  })
})
