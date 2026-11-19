/**
 * The mark an agent's own decision leaves on the event that recorded it, in a card's System
 * events. The oracle is the requirement: an event the full record marks with a participation
 * point carries the point's kind, in the words the Agent decisions page's point filter says it
 * with (`decisionPointMessages`), and an event with no point carries no mark; the history's
 * search finds the event by those words too.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import InspectorActivity from '@/widgets/work-item-inspector/components/InspectorActivity.vue'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import { decisionPointMessages } from '@/shared/i18n/decisionPointMessages.ts'
import { messages } from '@/shared/i18n/index.ts'
import VTextInput from '@/shared/ui/VTextInput.vue'

import { workItemFixture } from '../fixtures/workItem.ts'

const unproved = { state: 'unconfirmed', source: null, session_id: null, agent_id: null } as const

/** A card whose record holds a goal's close an agent decided itself, and a claim nobody marked. */
function markedItem() {
  const item = workItemFixture('Decided goal', 1)
  item.events = [
    {
      action: 'claimed',
      author: 'codex',
      at: '2026-10-23T10:00:00Z',
      detail: '',
      identity: unproved,
    },
    {
      action: 'transitioned',
      author: 'codex',
      at: '2026-10-23T11:00:00Z',
      detail: 'dev -> done',
      identity: unproved,
      point: 'goal_close',
    },
  ]
  item.refs = []
  // The record as the server's answer is read: the point is the full record's, not a guess here.
  return validateWorkItemRecord(JSON.parse(JSON.stringify(item)))
}

function mountActivity(locale: 'en' | 'ru') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages })
  return mount(InspectorActivity, { props: { item: markedItem() }, global: { plugins: [i18n] } })
}

/** Each row's title and its mark, if it has one, newest first. */
const rows = (wrapper: ReturnType<typeof mountActivity>) =>
  wrapper.findAll('li.entry').map((row) => ({
    title: row.get('.entry-title').text(),
    mark: row.find('.entry-point').exists() ? row.get('.entry-point').text() : null,
  }))

describe('an agent’s own decision in System events', () => {
  it('marks the event with its point’s kind in the page’s words, and no other event', () => {
    const wrapper = mountActivity('en')
    expect(rows(wrapper)).toEqual([
      {
        title: 'State changed',
        mark: `Agent’s own decision · ${decisionPointMessages.en.goal_close}`,
      },
      { title: 'Work claimed', mark: null },
    ])
    wrapper.unmount()
  })

  it('says the mark in Russian with the Russian point word', () => {
    const wrapper = mountActivity('ru')
    const marks = rows(wrapper).map((row) => row.mark)
    expect(marks).toEqual([`Решение агента · ${decisionPointMessages.ru.goal_close}`, null])
    wrapper.unmount()
  })

  it('finds the marked event by the point’s words', async () => {
    const wrapper = mountActivity('en')
    await wrapper.getComponent(VTextInput).setValue(decisionPointMessages.en.goal_close)
    expect(rows(wrapper).map((row) => row.title)).toEqual(['State changed'])
    wrapper.unmount()
  })
})
