import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SessionDetailDrawer from '@/widgets/session-detail/SessionDetailDrawer.vue'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { messages } from '@/shared/i18n/index.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import type { AgentSession } from '@/shared/types/session.ts'

const fetchSessionFeed = vi.fn()

vi.mock('@/shared/api/api', () => ({
  fetchSessionFeed: (...args: unknown[]) => fetchSessionFeed(...args),
  markSessionSeen: vi.fn(),
}))

function session(id: string): AgentSession {
  return {
    attention: '',
    attention_seen: false,
    client: 'Codex',
    client_family: 'codex',
    current_step: 'Reviewing',
    cwd: 'C:/workspace',
    ended_at: null,
    id,
    label: id,
    last_seen: '2026-08-24T12:00:00Z',
    quiet_seconds: 0,
    started_at: '2026-08-24T11:00:00Z',
    status: 'active',
    work_item: null,
  }
}

describe('session detail entity state', () => {
  beforeEach(() => {
    fetchSessionFeed.mockReset()
    fetchSessionFeed.mockImplementation(async (id: string) => ({ session: id, events: [] }))
  })

  it('does not carry an attach draft into another selected session', async () => {
    const wrapper = mount(SessionDetailDrawer, {
      props: {
        session: session('session-one'),
        requestedId: 'session-one',
        missing: false,
        revision: 'r1',
      },
      global: {
        plugins: [
          createPinia(),
          createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
        ],
      },
    })
    await flushPromises()

    const input = wrapper.get('input')
    await input.setValue('QA-308')
    expect(input.element.value).toBe('QA-308')

    await wrapper.setProps({
      session: session('session-two'),
      requestedId: 'session-two',
      revision: 'r2',
    })
    await flushPromises()

    expect(wrapper.get('input').element.value).toBe('')
  })

  it('uses the shared session semantic state and keeps disappeared details explicit', async () => {
    const selected = session('session-one')
    selected.attention = 'blocked'
    const wrapper = mount(SessionDetailDrawer, {
      props: {
        session: selected,
        requestedId: selected.id,
        missing: false,
        revision: 'r1',
      },
      global: {
        plugins: [
          createPinia(),
          createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
        ],
      },
    })
    await flushPromises()
    expect(wrapper.get('[data-dimension="session"]').attributes('data-state')).toBe('attention')

    await wrapper.setProps({ missing: true })
    expect(wrapper.text()).toContain('no longer in the latest successful snapshot')
    expect(wrapper.text()).toContain('session-one')
  })

  it('renders ended with unseen attention as neutral and quiet in the inspector', async () => {
    const selected = session('session-ended')
    selected.attention = 'late attention'
    selected.status = 'ended'
    selected.ended_at = '2026-08-24T12:05:00Z'
    const wrapper = mount(SessionDetailDrawer, {
      props: {
        session: selected,
        requestedId: selected.id,
        missing: false,
        revision: 'r1',
      },
      global: {
        plugins: [
          createPinia(),
          createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
        ],
      },
    })
    await flushPromises()
    const semantic = wrapper.get('[data-dimension="session"]')

    expect(semantic.attributes('data-state')).toBe('ended')
    expect(semantic.attributes('data-tone')).toBe('neutral')
    expect(semantic.attributes('data-emphasis')).toBe('quiet')
  })

  it('derives both the displayed space and item target from the canonical resource ref', async () => {
    const selected = session('session-bound')
    const resourceRef = planningSpaceEntity({
      data_scope_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      space_key: 'MAIN',
    }) as PlanningSpaceEntityRef
    selected.work_item = 'MAIN-42'
    selected.space_root = {
      canonical_root: 'C:/workspace',
      reason: '',
      resource_ref: resourceRef,
      status: 'mapped',
    }
    const wrapper = mount(SessionDetailDrawer, {
      props: {
        session: selected,
        requestedId: selected.id,
        missing: false,
        revision: 'r1',
      },
      global: {
        plugins: [
          createPinia(),
          createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages }),
        ],
      },
    })
    await flushPromises()

    expect(wrapper.get('.session-space').text()).toBe('MAIN')
    const itemAction = wrapper
      .findAll('button.session-action')
      .find((button) => button.text().includes('MAIN-42'))
    expect(itemAction).toBeDefined()
    await itemAction?.trigger('click')
    expect(wrapper.emitted('open-work-item')).toEqual([
      [{ reference: 'MAIN-42', resource_ref: resourceRef }],
    ])
  })
})
