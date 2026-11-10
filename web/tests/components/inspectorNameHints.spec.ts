/**
 * A name's hint on the card's facts never says the name the line already shows. The holder's
 * says the lease behind the claim and the follower's nothing, each with the whole session id
 * where the line prints only its start; the name itself is said only while the line cuts it.
 * The holder's hint was «codex» and the lease, the follower's its label as written.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import InspectorFacts from '@/widgets/work-item-inspector/components/InspectorFacts.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'
import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'

import { workItemFixture } from '../fixtures/workItem.ts'

const SESSION = '019a3c2e-0001-7c11-9e0f-2f4b6d8a1c3e'

function facts(record: WorkItem) {
  return mount(InspectorFacts, {
    props: { item: record, workflow: null, busy: false, writable: true },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { ChoiceSelect: true, VIcon: true },
    },
  })
}

function held(holder: string, followers: string[] = []): WorkItem {
  const base = workItemFixture('Held', 1)
  return {
    ...base,
    claim_ref: holder,
    claim_state: 'unconfirmed',
    claim: {
      holder,
      state: 'unconfirmed',
      session_id: null,
      agent_id: null,
      source: 'manual',
      acquired_at: '2026-08-01T10:00:00.000Z',
      last_seen: null,
      expires_at: null,
    },
    subscribers: followers.map((label) => ({
      session: '',
      client: '',
      agent: '',
      label,
      since: '2026-08-01T10:00:00Z',
    })),
  } as WorkItem
}

const LEASE = 'Claim: Unconfirmed — held until someone releases it'

describe("a name's hint on the card's facts", () => {
  it("is the holder's lease, never its name", () => {
    const wrapper = facts(held('codex'))
    const hint = tooltipOf(wrapper.get('.card-holder-name').element)
    expect(wrapper.get('.card-holder-name').text()).toBe('codex')
    expect(hint).toMatchObject({ kind: 'detail', text: LEASE, words: 'codex' })
    wrapper.unmount()
  })

  it("adds the holder's whole session where the line prints its start", () => {
    const wrapper = facts(held(`codex (session ${SESSION})`))
    const hint = tooltipOf(wrapper.get('.card-holder-name').element)
    expect(wrapper.get('.card-holder-name').text()).toBe('codex · 019a3c2e-0001')
    expect(hint).toMatchObject({ text: `${SESSION}\n${LEASE}`, words: 'codex · 019a3c2e-0001' })
    wrapper.unmount()
  })

  it('is nothing for a follower whose whole name is on the line', () => {
    const wrapper = facts(held('codex', ['claude', `claude (session ${SESSION})`]))
    const [plain, session] = wrapper.findAll('.card-subscriber')
    expect(plain?.text()).toBe('claude,')
    // With nothing to add, the hint is the name's own words, shown only while they are cut.
    expect(tooltipOf(plain?.element as Element)).toMatchObject({ clipped: true, text: 'claude' })
    expect(session?.text()).toBe('claude · 019a3c2e-0001')
    expect(tooltipOf(session?.element as Element)).toMatchObject({ clipped: false, text: SESSION })
    wrapper.unmount()
  })
})
