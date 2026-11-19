/**
 * The read of the Agent decisions page: every decision of its scope, point and period, read page
 * after page of the server's 200 (`readDecisions`) and held as one state the page's shared panel
 * draws (`PlatformStatePanel`).
 *
 * The first read draws its rows as each page lands, saying how many of how many are read, so a
 * long period shows its newest at once. Once something is drawn, a read again of the same view
 * replaces it only when it has read the whole, so nothing blinks or shrinks; a read of another
 * view keeps the last one drawn and dimmed (`pending`) until its own first page lands, so the last
 * view is never shown as the current one. A read again that fails keeps what is drawn and says it
 * could not refresh; a first read that fails is the shared error panel with its retry. A newer
 * read stops an older one still under way.
 *
 * Reading stops at `MOST` decisions, the newest, and the table says how many there are in all.
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { readDecisions } from '@/shared/api/decisionsApi.ts'
import type { Decision, DecisionsQuery } from '@/shared/api/decisionsApi.ts'
import { uiDegraded, uiEmpty, uiError, uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'

/** The most decisions a view reads: 25 pages of 200. */
export const MOST = 5000

/** What the table draws: the decisions read so far, how many there are, whether more are on the way. */
export interface DecisionsShown {
  items: Decision[]
  reading: boolean
  total: number
}

export function useDecisionsRead(options: {
  /** What the read asks; null for a period that cannot be read yet. */
  query: () => DecisionsQuery | null
  /** The view the read is of, its scope with it: a read again keeps it, another view does not. */
  view: () => unknown
}) {
  const state = shallowRef<PlatformUiState<DecisionsShown>>(uiLoading())
  /** The last view is drawn, dimmed, while another view's first page is on its way. */
  const pending = ref(false)
  let controller: AbortController | null = null
  let shownKey: string | null = null

  const drawn = () => {
    const now = state.value
    return now.status === 'ready' || now.status === 'degraded' ? now.payload : null
  }

  async function read() {
    controller?.abort()
    const asked = new AbortController()
    controller = asked
    const wanted = options.query()
    if (wanted === null) {
      pending.value = false
      shownKey = null
      state.value = uiEmpty('decisions.incomplete')
      return
    }
    const key = JSON.stringify(options.view())
    const again = key === shownKey && drawn() !== null
    pending.value = !again && drawn() !== null
    if (drawn() === null) state.value = uiLoading()
    const show = (items: Decision[], total: number, reading: boolean) => {
      shownKey = key
      pending.value = false
      state.value = total === 0 ? uiEmpty('decisions.empty') : uiReady({ items, total, reading })
    }
    try {
      const whole = await readDecisions(wanted, {
        most: MOST,
        signal: asked.signal,
        landed: (page) => {
          if (asked.signal.aborted || again) return
          show(page.items, page.total, page.items.length < Math.min(page.total, MOST))
        },
      })
      if (!asked.signal.aborted) show(whole.items, whole.total, false)
    } catch {
      if (asked.signal.aborted) return
      pending.value = false
      const kept = drawn()
      state.value = kept
        ? uiDegraded(kept, new Date().toISOString(), 'decisions.refreshFailed')
        : uiError('decisions.failed')
    }
  }

  watch(() => JSON.stringify(options.view()), read, { immediate: true })

  return {
    pending: computed(() => pending.value),
    /** Read the view on show again. */
    refresh: read,
    state: computed(() => state.value),
  }
}
