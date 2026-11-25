/**
 * The facts a card says only where the record gives them: why and when the work was accepted,
 * the state a goal derives, that a task waiting to be taken was started, a step its former
 * holder marked, and who works on a goal. One family a block, each with the record that gives
 * the fact and one that does not.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import InspectorFacts from '@/widgets/work-item-inspector/components/InspectorFacts.vue'
import InspectorOverview from '@/widgets/work-item-inspector/components/InspectorOverview.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

/** The card read again after a write. */
const reread = () => Promise.resolve()

const READY = { key: 'todo', name: 'To do', category: 'ready', is_terminal: false } as const
const DEV = { key: 'dev', name: 'Development', category: 'active', is_terminal: false } as const
const AT = '2026-11-03T10:00:00Z'

const DATES = { en: { activity: { year: 'numeric', month: 'short', day: '2-digit' } } } as const
const i18n = () => createI18n({ legacy: false, locale: 'en', messages, datetimeFormats: DATES })

function task(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    ...workItemFixture('Facts', 1),
    state: { ...READY, state_id: '00000000-0000-4000-8000-000000000004' },
    ...overrides,
  }
}

/** An accepted open goal: no state of its own, the one it derives, and no holder. */
function goal(overrides: Partial<WorkItem> = {}): WorkItem {
  return task({
    kind: 'goal',
    state: null,
    container_state: 'in_progress',
    claim_ref: '',
    claim_state: null,
    claim: null,
    ...overrides,
  })
}

function facts(record: WorkItem) {
  return mount(InspectorFacts, {
    props: { item: record, workflow: null, busy: false, writable: true },
    global: { plugins: [i18n()], stubs: { VIcon: true } },
  })
}

const row = (wrapper: ReturnType<typeof facts>, fact: string) =>
  wrapper.find(`[data-fact="${fact}"]`)

const started = (record: WorkItem) => facts(record).find('[data-mark="started"]')

/** A step worker-a marked done, by a lapsed lease or not. */
const step = (id: string, previous: boolean) => ({
  id,
  text: `Step ${id.slice(-1)}`,
  done: true,
  claimed_by: '',
  done_by: 'worker-a',
  by_previous_holder: previous,
})

describe('a card’s facts, each where the record gives it', () => {
  it('says why and when the work was accepted, in the basis’s own words', () => {
    const owner = facts(task({ acceptance: { basis: 'owner', at: AT } }))
    const accepted = row(owner, 'acceptance')
    expect(accepted.get('.card-row-label').text()).toBe('Accepted')
    expect(accepted.get('.card-row-value').text()).toMatch(/^owner · .*2026/u)
    const inherited = facts(task({ acceptance: { basis: 'inherited', at: AT } }))
    expect(row(inherited, 'acceptance').text()).toContain('as part of the goal')
    // Work nobody accepted yet says nothing of it.
    expect(row(facts(task({ acceptance: null })), 'acceptance').exists()).toBe(false)
  })

  it('says the state a goal derives, with no menu to move it', () => {
    const wrapper = facts(goal())
    const state = row(wrapper, 'state')
    expect(state.get('.card-row-value').text()).toContain('In progress')
    expect(state.find('[aria-haspopup]').exists()).toBe(false)
    const waiting = facts(goal({ container_state: 'awaiting_confirmation' }))
    expect(row(waiting, 'state').text()).toContain('Awaiting confirmation')
  })

  it('marks a task waiting to be taken that was started, and nothing else', () => {
    expect(started(task({ started_at: AT })).text()).toBe('started')
    // Under way, it says so by its state; not started, there is nothing to mark.
    expect(started(task({ started_at: AT, state: { ...DEV, state_id: 'x' } })).exists()).toBe(false)
    expect(started(task({ started_at: null })).exists()).toBe(false)
    // A goal's start is its first task's.
    expect(started(goal({ started_at: AT })).exists()).toBe(false)
  })

  it('names who works on a goal, with the tasks each holds, and offers no take', () => {
    const wrapper = facts(
      goal({
        participants: [
          {
            session: '4f2a91c0-0000-4000-8000-000000000001',
            client: 'claude',
            label: 'claude (session 4f2a91c0-0000-4000-8000-000000000001)',
            holds: ['QA-321'],
            follows: false,
            last_seen: AT,
          },
          {
            session: '9b03e7d2-0000-4000-8000-000000000002',
            client: 'codex',
            label: 'codex (session 9b03e7d2-0000-4000-8000-000000000002)',
            holds: [],
            follows: true,
            last_seen: AT,
          },
        ],
      }),
    )
    const working = row(wrapper, 'participants')
    expect(working.get('.card-row-label').text()).toBe('Working: 2')
    const names = working.findAll('[data-participant]')
    expect(names).toHaveLength(2)
    // Each by its client and the start of its session, as a holder is named.
    expect(names.map((name) => name.text().split(' · ')[0])).toEqual(['claude', 'codex'])
    expect(names[0].text()).toContain('4f2a91c0')
    expect(row(wrapper, 'holder').exists()).toBe(false)
    expect(wrapper.findAll('button').filter((button) => button.text() === 'Take')).toHaveLength(0)
    // A goal nobody works on keeps the held-by row; a task has a holder, never participants.
    expect(row(facts(goal({ participants: [] })), 'participants').exists()).toBe(false)
    expect(row(facts(task()), 'participants').exists()).toBe(false)
  })
})

describe('a step its former holder marked', () => {
  it('says so on Overview, beside who marked it', () => {
    const record = task()
    record.checklist = [
      step('00000000-0000-4000-8000-000000000011', true),
      step('00000000-0000-4000-8000-000000000012', false),
    ]
    const wrapper = mount(InspectorOverview, {
      props: { reread, item: record, writable: true },
      global: {
        plugins: [i18n()],
        stubs: { InspectorDescription: true, InspectorDiscussion: true, InspectorSummary: true },
      },
    })
    const marks = wrapper.findAll('.step-row')
    expect(marks).toHaveLength(2)
    expect(marks[0].get('[data-mark="by-previous-holder"]').text()).toBe(
      'marked by the former holder',
    )
    expect(marks[1].find('[data-mark="by-previous-holder"]').exists()).toBe(false)
  })
})
