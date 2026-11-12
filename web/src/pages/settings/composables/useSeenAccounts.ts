/**
 * The accounts agent work was billed to over the past year, as the usage read gives them by
 * account, the most agent time first, each with its share of that time. The Settings group that
 * names accounts lists these, and the accounts already named that the year did not see, so a name
 * can be taken away whenever it was given. Read once, when the group is shown.
 */
import { computed, onMounted, ref } from 'vue'

import { fetchUsage } from '@/shared/api/analyticsApi.ts'

/** How far back an account counts as seen: a year of days, well inside the read's bound. */
const SEEN_DAYS = 366

export interface SeenAccount {
  id: string
  /** Its share of the year's agent time, from 0 to 1. */
  share: number
}

const pad = (part: number) => String(part).padStart(2, '0')

/** A day of the local calendar as the read takes it, `2026-11-12`. */
function localDay(moment: Date) {
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`
}

export function useSeenAccounts(now: () => Date = () => new Date()) {
  const accounts = ref<SeenAccount[]>([])
  const state = ref<'failed' | 'loading' | 'ready'>('loading')

  async function read() {
    state.value = 'loading'
    const today = now()
    // By the calendar, not by 24 hours, so a change of the clock moves no day.
    const day = (offset: number) =>
      localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset))
    try {
      const usage = await fetchUsage({
        from: day(1 - SEEN_DAYS),
        to: day(1),
        utcOffset: -today.getTimezoneOffset(),
        groupBy: ['account'],
        filters: {},
        compare: false,
      })
      const whole = usage.total.agent_seconds
      accounts.value = usage.rows.flatMap((row) => {
        const id = row.group.account?.id
        return id ? [{ id, share: whole > 0 ? row.agent_seconds / whole : 0 }] : []
      })
      state.value = 'ready'
    } catch {
      state.value = 'failed'
    }
  }

  onMounted(read)

  return { accounts: computed(() => accounts.value), read, state: computed(() => state.value) }
}
