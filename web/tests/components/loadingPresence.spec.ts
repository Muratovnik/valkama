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

/** The panel's status region: what a screen reader hears of its waits. */
const region = (panel: Panel) => panel.get('.visually-hidden[role="status"]')

/**
 * Every text the status region held while a read answered after `answerAfter` ms and the
 * panel went on for the minimum, each change once: what a reader hears. `from` is the
 * state the panel stood in before the read began.
 */
async function heard(answerAfter: number, from?: PlatformUiState<string>) {
  const panel = mountPanel(from ?? uiLoading())
  const listened = region(panel).element
  const said: string[] = []
  const listen = () => {
    const same = region(panel).element === listened
    const text = same ? (listened.textContent ?? '').trim() : '(another region)'
    if (said.at(-1) !== text) said.push(text)
  }
  listen()
  if (from) await panel.setProps({ state: uiLoading() })
  for (let at = 0; at < answerAfter; at += 10) await advance(panel, 10).then(listen)
  await panel.setProps({ state: uiReady('work') })
  listen()
  for (let at = 0; at < LOADING_MIN_SHOWN_MS + 50; at += 10) await advance(panel, 10).then(listen)
  return said
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a wait is shown only once it has lasted, and then long enough to be read', () => {
  it('stands busy with an empty status region from the start, and says its word after the delay', async () => {
    const panel = mountPanel(uiLoading())
    const busy = panel.get('[aria-busy="true"]')
    // The place it holds and the region a screen reader listens to are there at once; the
    // word is not, so a read that answers first is never announced. The region stands
    // outside the busy box, which some readers keep quiet until it is no longer busy.
    expect(busy.attributes('role')).toBeUndefined()
    expect(busy.text()).toBe('')
    expect(busy.find('[role="status"]').exists()).toBe(false)
    expect(region(panel).text()).toBe('')
    expect(seen(panel)).toBe('nothing')
    await advance(panel, LOADING_DELAY_MS - 1)
    expect(seen(panel)).toBe('nothing')
    expect(region(panel).text()).toBe('')
    await advance(panel, 1)
    expect(seen(panel)).toBe('loading')
    expect(busy.text()).toBe('Loading')
    expect(region(panel).text()).toBe('Loading')
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

  it('announces a wait once, into the region that stood before it, and a quick one never', async () => {
    expect(await heard(LOADING_DELAY_MS - 50)).toEqual([''])
    // Said once at the delay, the same words through the minimum, and gone with the mark.
    expect(await heard(LOADING_DELAY_MS + 50)).toEqual(['', 'Loading', ''])
    expect(await heard(LOADING_DELAY_MS * 4)).toEqual(['', 'Loading', ''])
  })

  it('announces a wait that follows what was drawn in the region that stood beside it', async () => {
    // The region stood with the content, so a read again is heard as the first one is.
    expect(await heard(LOADING_DELAY_MS - 50, uiReady('drawn'))).toEqual([''])
    expect(await heard(LOADING_DELAY_MS + 50, uiReady('drawn'))).toEqual(['', 'Loading', ''])
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
