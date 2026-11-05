import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { uiError, uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import { messages } from '@/shared/i18n/index.ts'
import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'

const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })

function mountPanel(state: PlatformUiState<string>, since?: number) {
  return mount(PlatformStatePanel, {
    global: { plugins: [i18n] },
    attrs: { class: 'host-place' },
    props: { state, since },
    slots: { default: '<p class="content">The work</p>' },
  })
}

type Panel = ReturnType<typeof mountPanel>

/** The panel as a reader sees it: nothing, the wait, or the content. */
function seen(panel: Panel) {
  if (panel.find('.content').exists()) return 'content'
  const busy = panel.find('[aria-busy="true"]')
  if (!busy.exists()) return 'other'
  return busy.classes('waiting') ? 'nothing' : 'loading'
}

async function advance(panel: Panel, ms: number) {
  vi.advanceTimersByTime(ms)
  await panel.vm.$nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a wait is shown only once it has lasted, and then long enough to be read', () => {
  it('stands busy with its words from the start, and paints only after the delay', async () => {
    const panel = mountPanel(uiLoading())
    const busy = panel.get('[aria-busy="true"]')
    // The place it holds and what assistive technology reads are there at once.
    expect(busy.attributes('role')).toBe('status')
    expect(busy.classes()).toContain('host-place')
    expect(busy.text()).toContain('Loading')
    expect(seen(panel)).toBe('nothing')
    await advance(panel, LOADING_DELAY_MS - 1)
    expect(seen(panel)).toBe('nothing')
    await advance(panel, 1)
    expect(seen(panel)).toBe('loading')
  })

  it('a read that answers inside the delay goes straight to the content', async () => {
    const panel = mountPanel(uiLoading())
    await advance(panel, LOADING_DELAY_MS - 1)
    await panel.setProps({ state: uiReady('work') })
    expect(seen(panel)).toBe('content')
    await advance(panel, LOADING_DELAY_MS + LOADING_MIN_SHOWN_MS)
    expect(seen(panel)).toBe('content')
  })

  it('a wait just shown stays for the minimum, whatever arrives meanwhile', async () => {
    const panel = mountPanel(uiLoading())
    await advance(panel, LOADING_DELAY_MS)
    await panel.setProps({ state: uiReady('work') })
    expect(seen(panel)).toBe('loading')
    expect(panel.find('.content').exists()).toBe(false)
    await advance(panel, LOADING_MIN_SHOWN_MS - 1)
    expect(seen(panel)).toBe('loading')
    await advance(panel, 1)
    expect(seen(panel)).toBe('content')
  })

  it('a failure after a wait just shown waits its turn too, and then says it failed', async () => {
    const panel = mountPanel(uiLoading())
    await advance(panel, LOADING_DELAY_MS)
    await panel.setProps({ state: uiError('platform.failures.viewDownloadFailed') })
    expect(seen(panel)).toBe('loading')
    await advance(panel, LOADING_MIN_SHOWN_MS)
    expect(panel.find('[role="alert"]').exists()).toBe(true)
    expect(panel.find('[aria-busy="true"]').exists()).toBe(false)
  })

  it('a wait that outlasted the minimum ends the moment its read answers', async () => {
    const panel = mountPanel(uiLoading())
    await advance(panel, LOADING_DELAY_MS + LOADING_MIN_SHOWN_MS)
    await panel.setProps({ state: uiReady('work') })
    expect(seen(panel)).toBe('content')
  })

  it('content read again in a moment never shows a wait: a switch that answers quickly', async () => {
    const panel = mountPanel(uiReady('work'))
    await panel.setProps({ state: uiLoading() })
    expect(seen(panel)).toBe('nothing')
    await advance(panel, LOADING_DELAY_MS - 1)
    await panel.setProps({ state: uiReady('next') })
    expect(seen(panel)).toBe('content')
  })

  it('counts its delay from when the wait began, not from when it was drawn', async () => {
    const started = Date.now()
    vi.advanceTimersByTime(LOADING_DELAY_MS)
    expect(seen(mountPanel(uiLoading(), started))).toBe('loading')

    const partway = mountPanel(uiLoading(), Date.now() - (LOADING_DELAY_MS - 50))
    expect(seen(partway)).toBe('nothing')
    await advance(partway, 49)
    expect(seen(partway)).toBe('nothing')
    await advance(partway, 1)
    expect(seen(partway)).toBe('loading')
  })
})
