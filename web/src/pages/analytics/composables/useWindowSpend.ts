/**
 * What used a window of the quota, read for the window the side panel over the page shows and for
 * nothing else: the window's block there asks when it is drawn, by the breakdown chosen for it
 * (`spendQuery`).
 *
 * The side panel holds the reads of the windows it opens in one place for as long as the page
 * stands (`provideWindowSpend`), for the step of the quota answer's moment they are read to
 * (`SPEND_STEP`): a window opened again within the step takes the answer it had, with no wait.
 * The breakdown and the drawing chosen for a window are held there too, so they stand when the
 * window opens again.
 *
 * Each read is the block's own: its wait, its failure and its retry stand in its block, and the
 * quota's read neither waits for it nor fails with it. While a window is read again — a newer step,
 * another breakdown — what it showed stays; a read again that fails keeps it and says so, and a
 * first read that fails says it could not be read. A later read always replaces an earlier one.
 */
import { computed, inject, onScopeDispose, provide, reactive, shallowRef, watch } from 'vue'
import type { InjectionKey } from 'vue'

import { createSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import type { SharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'
import { accountKey, windowKey } from '@/pages/analytics/utils/quotaFigures.ts'
import type { SplitView } from '@/pages/analytics/utils/splitView.ts'
import { seatOf, SPEND_STEP, spendQuery, windowSpent } from '@/pages/analytics/utils/windowSpend.ts'
import type { SpendBy, WindowSpent } from '@/pages/analytics/utils/windowSpend.ts'

import { usageParameters } from '@/shared/api/analyticsApi.ts'
import type { Quota, QuotaAccount, QuotaShareWindow, Usage } from '@/shared/api/analyticsApi.ts'

/**
 * Where a window's read stands: its first wait, a first read that failed, or an answer — the
 * breakdown and the period it was read for, `refreshing` while another is read over it, and
 * `failedAgain` once a read again failed and this one stayed.
 */
export type WindowSpendRead =
  | { status: 'failed' }
  | { status: 'loading' }
  | {
      by: SpendBy
      failedAgain: boolean
      period: Usage['period']
      refreshing: boolean
      spent: WindowSpent
      status: 'ready'
    }

interface PanelSpend {
  /** The breakdown chosen for each window, by its account's key and its own. */
  choices: Map<string, SpendBy>
  /** The drawing chosen for each window, by the same key; none before a person chooses. */
  drawings: Map<string, SplitView>
  reads: SharedUsage
  quota: () => Pick<Quota, 'now' | 'utc_offset'> | null
}

const PANEL: InjectionKey<PanelSpend> = Symbol('analytics-window-spend')

/** The panel's reads of what used its windows, to the step of `quota`'s moment. */
export function provideWindowSpend(quota: () => Pick<Quota, 'now' | 'utc_offset'> | null) {
  const step = () => {
    const now = quota()?.now
    return now === undefined ? '' : String(Math.floor(Date.parse(now) / SPEND_STEP))
  }
  provide(PANEL, {
    choices: reactive(new Map()),
    drawings: reactive(new Map()),
    quota,
    reads: createSharedUsage(step),
  })
}

/** What used one window of one account, read while its block is drawn in the side panel. */
export function useWindowSpend(options: {
  account: () => QuotaAccount
  window: () => QuotaShareWindow
}) {
  const provided = inject(PANEL, null)
  if (!provided) throw new Error('a window’s spend is read inside the side panel')
  const panel = provided

  const key = computed(() => `${accountKey(options.account())}|${windowKey(options.window())}`)
  const by = computed<SpendBy>({
    get: () => panel.choices.get(key.value) ?? 'work_item',
    set: (value) => panel.choices.set(key.value, value),
  })
  const drawn = computed<SplitView | null>({
    get: () => panel.drawings.get(key.value) ?? null,
    set: (value) => {
      if (value) panel.drawings.set(key.value, value)
    },
  })
  const query = computed(() => {
    const quota = panel.quota()
    return quota && spendQuery(options.account(), options.window(), quota, by.value)
  })

  const read = shallowRef<WindowSpendRead>({ status: 'loading' })
  let reading: AbortController | null = null

  async function load() {
    const asked = query.value
    const seat = seatOf(options.account())
    if (!asked || seat === null) return
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    const chosen = by.value
    const answer = (usage: Usage): WindowSpendRead => ({
      status: 'ready',
      by: chosen,
      period: usage.period,
      spent: windowSpent(usage, seat, chosen),
      refreshing: false,
      failedAgain: false,
    })
    const held = panel.reads.peek(asked)
    if (held) {
      read.value = answer(held)
      return
    }
    const shown = read.value
    read.value =
      shown.status === 'ready'
        ? { ...shown, refreshing: true, failedAgain: false }
        : { status: 'loading' }
    try {
      const usage = await panel.reads.read(asked, controller.signal)
      if (!controller.signal.aborted) read.value = answer(usage)
    } catch {
      if (controller.signal.aborted) return
      read.value =
        shown.status === 'ready' && shown.by === chosen
          ? { ...shown, refreshing: false, failedAgain: true }
          : { status: 'failed' }
    }
  }

  watch(
    () => (query.value ? usageParameters(query.value).toString() : null),
    () => void load(),
    { immediate: true },
  )
  onScopeDispose(() => reading?.abort())

  return { by, drawn, read, retry: load }
}
