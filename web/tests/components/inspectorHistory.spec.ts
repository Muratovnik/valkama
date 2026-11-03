import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import InspectorActivity from '@/widgets/work-item-inspector/components/InspectorActivity.vue'
import InspectorExecution from '@/widgets/work-item-inspector/components/InspectorExecution.vue'
import {
  groupHistory,
  matchesRecorded,
} from '@/widgets/work-item-inspector/utils/historyRecords.ts'

import OpenAction from '@/features/session-open/OpenAction.vue'

import { validateHistory } from '@/shared/api/executionModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { activityMessages } from '@/shared/i18n/activityMessages.ts'
import { messages } from '@/shared/i18n/index.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

import { executionHistory } from '../browser/executionFixtures.ts'
import { workItemFixture } from '../fixtures/workItem.ts'
import { present } from '../support/present.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

function plugins() {
  return [
    createI18n({
      legacy: false,
      locale: 'en',
      messages: { en: { ...messages.en, ...activityMessages.en } },
    }),
  ]
}

/** What an event carries when no call proved who wrote it. */
const unproved = { state: 'unconfirmed', source: null, session_id: null, agent_id: null } as const

function activityItem() {
  const item = workItemFixture('History task', 1)
  item.events = [
    {
      action: 'created',
      author: 'A',
      at: '2026-10-22T10:00:00Z',
      detail: 'earlier',
      identity: unproved,
    },
    {
      action: 'claimed',
      author: 'B',
      at: '2026-10-23T10:00:00Z',
      detail: 'needle in detail',
      identity: unproved,
    },
  ]
  item.refs = [
    {
      kind: 'commit',
      value: 'sha-hidden-123',
      label: 'delivery',
      author: 'A',
      at: '2026-10-23T11:00:00Z',
    },
  ]
  return item
}

describe('recorded history', () => {
  it('orders dates newest first, preserves ties and puts unknown times last', () => {
    const records = [
      { id: 'unknown', at: 'not a date' },
      { id: 'old', at: '2026-10-22T10:00:00Z' },
      { id: 'first', at: '2026-10-23T10:00:00Z' },
      { id: 'second', at: '2026-10-23T10:00:00Z' },
    ]
    const groups = groupHistory(records, (entry) => entry.at)
    expect(groups.map((group) => group.records.map((entry) => entry.id))).toEqual([
      ['first', 'second'],
      ['old'],
      ['unknown'],
    ])
    expect(groups.at(-1)?.date).toBeNull()
    expect(records[0]?.id).toBe('unknown')
  })

  it('searches nested recorded results, evidence and session context', () => {
    const attempt = present(validateHistory(executionHistory).executions[0], 'execution')
    expect(
      matchesRecorded(attempt, present(attempt.sessions[0], 'session').session_id.toUpperCase()),
    ).toBe(true)
    expect(
      matchesRecorded({ result: { oracle: 'Evidence beyond preview' } }, ' BEYOND PREVIEW '),
    ).toBe(true)
    expect(matchesRecorded(attempt, 'missing-field-value')).toBe(false)
  })

  it('filters full activity fields, distinguishes no matches and resets for a different item', async () => {
    const wrapper = mount(InspectorActivity, {
      props: { item: activityItem() },
      global: { plugins: plugins() },
    })
    expect(wrapper.findAll('li').map((entry) => entry.text())).toEqual([
      expect.stringContaining('sha-hidden-123'),
      expect.stringContaining('needle in detail'),
      expect.stringContaining('earlier'),
    ])
    await wrapper.getComponent(VTextInput).setValue('sha-hidden-123')
    expect(wrapper.findAll('li')).toHaveLength(1)
    await present(wrapper.findAllComponents(ChoiceSelect)[0], 'category filter').vm.$emit(
      'update:modelValue',
      'event',
    )
    expect(wrapper.text()).toContain('No matching records')
    const next = activityItem()
    next.work_item_id = '00000000-0000-4000-8000-000000000321'
    await wrapper.setProps({ item: next })
    expect(wrapper.findAll('li')).toHaveLength(3)
    present(wrapper.findAllComponents(ChoiceSelect)[1], 'author filter').vm.$emit(
      'update:modelValue',
      'B',
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('li')).toHaveLength(1)
    expect(wrapper.get('li').text()).toContain('needle in detail')
    await wrapper.setProps({ item: workItemFixture('Empty', 1) })
    expect(wrapper.text()).toContain(messages.en.workItem.noActivity)
    wrapper.unmount()
  })

  it('renders unknown action and timestamp honestly and shows the recorded detail on the row', () => {
    const item = activityItem()
    item.events = [
      { action: 'future_action', at: 'unknown timestamp', author: 'A', detail: 'retained' },
    ] as unknown as WorkItem['events']
    item.refs = []
    const wrapper = mount(InspectorActivity, { props: { item }, global: { plugins: plugins() } })
    expect(wrapper.text()).toContain('System event: future_action')
    expect(wrapper.text()).toContain('Unknown date')
    expect(wrapper.text()).toContain('unknown timestamp')
    // The substance is the row's second line, not hidden behind a disclosure.
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.get('li .entry-detail').text()).toBe('retained')
    expect(wrapper.get('li > .entry-line').text()).toContain('System event: future_action')
    wrapper.unmount()
  })

  it('filters execution records while retaining launch, stop, session and error behavior', async () => {
    // Its session's button asks the server where it would open.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    )
    const attempt = present(validateHistory(executionHistory).executions[0], 'execution')
    attempt.presence = 'live'
    const wrapper = mount(InspectorExecution, {
      props: {
        identity: 'item-a',
        busy: false,
        error: '',
        executions: [attempt],
        loading: false,
        writable: true,
      },
      global: { plugins: plugins() },
    })
    await wrapper
      .getComponent(VTextInput)
      .setValue(present(attempt.sessions[0], 'session').session_id)
    expect(wrapper.findAll('.attempt')).toHaveLength(1)
    const action = wrapper.getComponent(OpenAction)
    expect(action.props('session')).toBe(present(attempt.sessions[0], 'session').session_id)
    expect(action.props('family')).toBe('claude')
    await wrapper.getComponent(VTextInput).setValue('absent')
    expect(wrapper.text()).toContain('No matching records')
    expect(
      wrapper.findAll('button').some((button) => button.text() === messages.en.execution.stop),
    ).toBe(true)
    await wrapper.setProps({ identity: 'item-b' })
    expect(wrapper.findAll('.attempt')).toHaveLength(1)
    const other = {
      ...attempt,
      execution_id: 'other-attempt',
      status: 'failed' as const,
      client_family: 'other-client',
      presence: 'terminal' as const,
    }
    await wrapper.setProps({ executions: [attempt, other] })
    present(wrapper.findAllComponents(ChoiceSelect)[0], 'status filter').vm.$emit(
      'update:modelValue',
      'failed',
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.attempt')).toHaveLength(1)
    expect(wrapper.get('.attempt').text()).toContain('other-client')
    present(wrapper.findAllComponents(ChoiceSelect)[1], 'client filter').vm.$emit(
      'update:modelValue',
      attempt.client_family,
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('No matching records')
    await wrapper.setProps({ loading: true })
    expect(wrapper.text()).toContain(messages.en.execution.loading)
    await wrapper.setProps({ loading: false, error: 'Unavailable record', writable: false })
    expect(wrapper.get('[role="alert"]').text()).toBe('Unavailable record')
    expect(wrapper.find('.execution-actions').exists()).toBe(false)
    wrapper.unmount()
  })
})
