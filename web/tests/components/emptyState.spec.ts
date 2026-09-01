import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { uiEmpty } from '@/shared/api/platformUiState.ts'
import { messages } from '@/shared/i18n/index.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const i18n = createI18n({ legacy: false, locale: 'ru', fallbackLocale: 'en', messages })

function mountEmpty(reason?: string, slots: Record<string, string> = {}) {
  return mount(PlatformStatePanel, {
    global: { plugins: [i18n] },
    props: { state: uiEmpty(reason), retryable: false },
    slots,
  })
}

/**
 * An absence is one sentence, said once, standing in the middle of the space
 * the data would occupy. The empty status used to run through the failure
 * band — icon at the left wall, a generic headline centered across the full
 * width, the caller's reason inside a left-anchored 68ch box — so a wide
 * table showed three loose pieces in three different places, and every one
 * of them said "nothing here" in its own words.
 */
describe('the empty state says one thing, in one place', () => {
  it('renders the caller reason as the only message, not under a generic headline', () => {
    const panel = mountEmpty('В этом фильтре нет сессий.')

    expect(panel.find('.platform-state-panel').exists()).toBe(false)
    expect(panel.find('.platform-state-title').exists()).toBe(false)
    const empty = panel.get('.data-empty')
    expect(empty.get('.empty-title').text()).toBe('В этом фильтре нет сессий.')
    expect(empty.text()).toBe('В этом фильтре нет сессий.')
  })

  it('falls back to the generic line when the caller gives no reason', () => {
    const panel = mountEmpty()

    expect(panel.get('.empty-title').text()).toBe('Здесь пока пусто')
  })

  it('translates a stable empty-state reason instead of printing its key', () => {
    const panel = mountEmpty('platform.planning.noSpaces')

    expect(panel.get('.empty-title').text()).toBe('Привязанных пространств пока нет.')
    expect(panel.text()).not.toContain('platform.planning.noSpaces')
  })

  it('keeps announcing itself as a live status region', () => {
    const panel = mountEmpty('В этом фильтре нет сессий.')

    expect(panel.get('.data-empty').attributes('role')).toBe('status')
  })

  it('carries a caller-provided action into the empty rendering', () => {
    const panel = mountEmpty('Нет данных.', {
      action: '<button type="button" class="probe-action">Показать все</button>',
    })

    expect(panel.get('.data-empty .probe-action').text()).toBe('Показать все')
  })
})
