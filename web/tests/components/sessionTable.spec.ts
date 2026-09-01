import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SessionTable from '@/pages/sessions/SessionTable.vue'

import { messages } from '@/shared/i18n/index.ts'
import type { AgentSession } from '@/shared/types/session.ts'

const markSessionSeen = vi.fn()

vi.mock('@/shared/api/api', () => ({
  markSessionSeen: (...args: unknown[]) => markSessionSeen(...args),
}))

function session(): AgentSession {
  return {
    attention: 'blocked',
    attention_seen: false,
    client: 'Codex',
    current_step: 'Waiting',
    cwd: 'C:/workspace',
    ended_at: null,
    id: 'selected',
    label: 'Selected session',
    last_seen: '2026-08-27T12:00:00Z',
    quiet_seconds: 0,
    started_at: '2026-08-27T11:00:00Z',
    status: 'active',
    work_item: null,
  }
}

function mountTable() {
  return mount(SessionTable, {
    props: { selectedId: null, sessions: [session()] },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
    },
  })
}

describe('session ledger state and acknowledgement', () => {
  beforeEach(() => markSessionSeen.mockReset())

  it('uses the canonical session semantic state', () => {
    const wrapper = mountTable()
    expect(wrapper.get('[data-dimension="session"]').attributes('data-state')).toBe('attention')
  })

  it('renders an ended session with unseen attention as neutral and quiet', () => {
    const ended = { ...session(), ended_at: '2026-08-27T12:05:00Z', status: 'ended' as const }
    const wrapper = mount(SessionTable, {
      props: { selectedId: null, sessions: [ended] },
      global: {
        plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
      },
    })
    const semantic = wrapper.get('[data-dimension="session"]')

    expect(semantic.attributes('data-state')).toBe('ended')
    expect(semantic.attributes('data-tone')).toBe('neutral')
    expect(semantic.attributes('data-emphasis')).toBe('quiet')
  })

  it('keeps acknowledgement pessimistic, shows failure by its row, and clears it after retry', async () => {
    markSessionSeen
      .mockRejectedValueOnce({ code: 'mutation_failed', status: 500, retryable: true })
      .mockResolvedValueOnce(undefined)
    const wrapper = mountTable()

    await wrapper.get('.ack-inline').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('The change was not saved')
    expect(wrapper.find('.ack-inline').exists()).toBe(true)

    await wrapper.get('.ack-failure .button').trigger('click')
    await flushPromises()
    expect(markSessionSeen).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.ack-failure').exists()).toBe(false)
    expect(wrapper.find('.ack-inline').exists()).toBe(true)
  })
})
