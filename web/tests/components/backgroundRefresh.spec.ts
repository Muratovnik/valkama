import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { uiDegraded, uiError, uiReady } from '@/shared/api/platformUiState.ts'
import { messages } from '@/shared/i18n/index.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const i18n = createI18n({ legacy: false, locale: 'ru', fallbackLocale: 'en', messages })

function mountPanel() {
  return mount(PlatformStatePanel, {
    global: { plugins: [i18n] },
    props: { state: uiReady({ title: 'first' }) },
    slots: { default: '<div class="probe">content</div>' },
  })
}

/**
 * A refresh is a background event: it may change what a screen says, never
 * whether the screen still exists. Both defects this guards against were
 * measured in the live application rather than imagined — the graph canvas was
 * remounted with an unfitted camera, and the layout jumped by the height of the
 * line that announced the refresh.
 */
describe('a background refresh leaves the rendered view in place', () => {
  it('keeps the very same DOM node when ready becomes degraded', async () => {
    const panel = mountPanel()
    const before = panel.find('.probe').element

    await panel.setProps({
      state: uiDegraded({ title: 'first' }, new Date('2026-08-16T10:00:00Z').toISOString()),
    })
    await nextTick()

    // Identity, not presence: two branches each rendering the slot would both
    // pass a `.probe` existence check while rebuilding the subtree underneath.
    expect(panel.find('.probe').element).toBe(before)
  })

  it('announces an in-flight refresh without taking a line of the layout', async () => {
    const panel = mountPanel()

    await panel.setProps({
      state: uiDegraded({ title: 'first' }, new Date('2026-08-16T10:00:00Z').toISOString()),
    })
    await nextTick()

    const live = panel.get('[role="status"]')
    expect(live.classes()).toContain('visually-hidden')
    expect(panel.find('.platform-state-banner').exists()).toBe(false)
  })

  it('still raises a banner when the refresh actually failed', async () => {
    const panel = mountPanel()

    await panel.setProps({
      state: uiDegraded(
        { title: 'first' },
        new Date('2026-08-16T10:00:00Z').toISOString(),
        'the board service did not answer',
      ),
    })
    await nextTick()

    const banner = panel.get('.platform-state-banner')
    expect(banner.text()).toContain('the board service did not answer')
    expect(banner.attributes('data-tone')).toBe('warning')
    expect(banner.classes()).not.toContain('degraded')
  })

  it('renders a failure edge from the closed platform state presentation', async () => {
    const panel = mountPanel()

    await panel.setProps({ state: uiError('the board service did not answer') })
    await nextTick()

    const failure = panel.get('.platform-state-panel')
    expect(failure.attributes('data-tone')).toBe('danger')
    expect(failure.classes()).not.toContain('error')
  })
})
