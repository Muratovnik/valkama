import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SessionsView from '@/pages/sessions/SessionsView.vue'

import { uiEmpty, uiError, uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { messages } from '@/shared/i18n/index.ts'
import type { SessionsPayload } from '@/shared/types/session.ts'

function mountView(state: PlatformUiState<SessionsPayload>) {
  return mount(SessionsView, {
    props: { revisions: {}, selected: null, state },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })],
      stubs: {
        InfoTip: true,
        SegmentedControl: true,
        SessionDetailDrawer: {
          props: ['missing', 'requestedId', 'session'],
          template:
            '<aside class="session-detail-stub" :data-missing="missing">{{ session?.id ?? requestedId }}</aside>',
        },
      },
    },
  })
}

describe('sessions view read state', () => {
  it('renders a cold sessions failure as error and emits an executable retry', async () => {
    const wrapper = mountView(uiError('Sessions could not be loaded.'))
    expect(wrapper.find('.platform-state-panel[data-tone="danger"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('No agent session has reported yet.')

    await wrapper.get('.platform-state-retry').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('renders only a successful zero snapshot as empty', () => {
    const wrapper = mountView(uiEmpty('monitor.empty'))
    expect(wrapper.find('.platform-state-panel[data-tone="danger"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No agent session has reported yet.')
  })

  it('keeps the selected inspector explicit when a successful snapshot removes its session', async () => {
    const selected = {
      attention: '',
      attention_seen: false,
      client: 'Codex',
      current_step: 'Working',
      cwd: 'C:/workspace',
      ended_at: null,
      id: 'selected',
      label: 'Selected',
      last_seen: '2026-08-27T12:00:00Z',
      quiet_seconds: 0,
      started_at: '2026-08-27T11:00:00Z',
      status: 'active' as const,
      work_item: null,
    }
    const wrapper = mountView(uiReady({ inbox: [], sessions: [selected] }))
    await wrapper.setProps({
      state: uiReady({ inbox: [], sessions: [{ ...selected, current_step: 'Fresh snapshot' }] }),
      selected: 'selected',
    })
    expect(wrapper.get('.session-detail-stub').text()).toBe('selected')

    await wrapper.setProps({ state: uiEmpty('monitor.empty') })
    expect(wrapper.get('.session-detail-stub').attributes('data-missing')).toBe('true')
    expect(wrapper.get('.session-detail-stub').text()).toBe('selected')
  })
})
