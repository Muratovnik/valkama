/**
 * The page's subscription quota: its read (`useQuotaRead`), the clock its ages and the time left
 * to each reset are counted to, and its two tiles on the rail (`useQuotaTiles`).
 *
 * The clock moves every few seconds, as the bar's age of the figures does, so a window whose
 * reset passed stops counting toward its tile without a read again.
 */
import { computed } from 'vue'

import { useIntervalFn, useNow } from '@vueuse/core'

import { useQuotaRead } from '@/pages/analytics/composables/useQuotaRead.ts'
import { useQuotaTiles } from '@/pages/analytics/composables/useQuotaTiles.ts'

const TICK_MS = 5000

export function useQuota() {
  const { read, refresh } = useQuotaRead()
  const clock = useNow({ scheduler: (tick) => useIntervalFn(tick, TICK_MS) })
  const now = computed(() => clock.value.getTime())
  const { tiles } = useQuotaTiles({ read: () => read.value, now: () => now.value })
  return { now, read, refresh, tiles }
}
