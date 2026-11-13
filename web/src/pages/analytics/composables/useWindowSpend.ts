/**
 * What used each window of the quota panel, read for the windows the panel shows and for nothing
 * else: a window's block asks when it is drawn, by the breakdown chosen for it (`spendQuery`).
 *
 * The panel holds the reads of its windows in one place (`provideWindowSpend`), for the step of
 * the quota answer's moment they are read to (`SPEND_STEP`): the chart and the table of the panel
 * are each a block of their own, and a block drawn again within the step takes the answer the
 * other had, with no wait. The breakdown chosen for a window is the panel's too, so it stands when
 * the panel turns from the chart to the table.
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
  provide(PANEL, { choices: reactive(new Map()), quota, reads: createSharedUsage(step) })
}

/** What used one window of one account, read while its block is drawn in the quota panel. */
export function useWindowSpend(options: {
  account: () => QuotaAccount
  window: () => QuotaShareWindow
}) {
  const provided = inject(PANEL, null)
  if (!provided) throw new Error('a window’s spend is read inside the quota panel')
  const panel = provided

  const key = computed(() => `${accountKey(options.account())}|${windowKey(options.window())}`)
  const by = computed<SpendBy>({
    get: () => panel.choices.get(key.value) ?? 'work_item',
    set: (value) => panel.choices.set(key.value, value),
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

  return { by, read, retry: load }
}
