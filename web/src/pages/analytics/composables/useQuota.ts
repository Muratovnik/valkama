/**
 * The page's subscription quota: its read (`useQuotaRead`) with the windows before the current ones
 * since the start of the page's period (`from`), the clock its ages and the time left to each reset
 * are counted to, and its two tiles on the rail (`useQuotaTiles`).
 *
 * The clock moves every few seconds, as the bar's age of the figures does, so a window whose
 * reset passed stops counting toward its tile without a read again.
 *
 * A read again that failed is said where every read of the page says it, in the bar beside the
 * data's age (`provideQuotaStanding`), and its figures stay as they stood: a line in the panel
 * moved everything under it. No new view reaches the quota, so it never reads one anew.
 */
import { computed, shallowRef } from 'vue'

import { useIntervalFn, useNow } from '@vueuse/core'

import { useQuotaRead } from '@/pages/analytics/composables/useQuotaRead.ts'
import { useQuotaTiles } from '@/pages/analytics/composables/useQuotaTiles.ts'
import { provideQuotaStanding } from '@/pages/analytics/composables/useReadStanding.ts'

const TICK_MS = 5000

export function useQuota(options: { from: () => string | null }) {
  const { read, refresh } = useQuotaRead(options)
  const clock = useNow({ scheduler: (tick) => useIntervalFn(tick, TICK_MS) })
  const now = computed(() => clock.value.getTime())
  const { tiles } = useQuotaTiles({ read: () => read.value, now: () => now.value })
  provideQuotaStanding({
    anew: shallowRef(false),
    failed: computed(() => read.value.status === 'ready' && read.value.failedAgain),
  })
  return { now, read, refresh, tiles }
}
