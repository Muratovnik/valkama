/**
 * The organizations agent work was billed to over the past year and their accounts: the usage read
 * by account (`seat`) over a year of days, and the quota read, which names the accounts its
 * readings of the past seven days were on (`docs/connection-contract.md`). An organization holds
 * its share of the year's agent time, its work on no known account counted in, and each of its
 * accounts its own; an account the quota names and the year's work did not show has none. The
 * Settings group that names accounts lists these (`seenAccountRows.ts`). Read once, when the group
 * is shown; either read failing fails both, so the list is never half of what it says.
 */
import { computed, onMounted, ref } from 'vue'

import { readAccountId } from '@/shared/api/accountIds.ts'
import { fetchQuota, fetchUsage } from '@/shared/api/analyticsApi.ts'

/** How far back an account counts as seen: a year of days, well inside the read's bound. */
const SEEN_DAYS = 366

export interface SeenAccount {
  /** Its id (`accountIds.ts`), by which its name is kept. */
  id: string
  /** Its share of the year's agent time, from 0 to 1; null where the year saw no work on it. */
  share: number | null
  /** Two accounts' readings may run under it. */
  shared: boolean
  /** The time of week its week resets, `4T09:00Z`, where a reading of it says. */
  weeklyReset: string | null
}

export interface SeenOrganization {
  accounts: SeenAccount[]
  id: string
  /** Its share of the year's agent time, from 0 to 1; null where the year saw no work of it. */
  share: number | null
}

const pad = (part: number) => String(part).padStart(2, '0')

/** A day of the local calendar as the read takes it, `2026-11-12`. */
function localDay(moment: Date) {
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`
}

/** The most agent time first, then by id; one the year saw no work on after every one it did. */
const bySpent = (left: { id: string; share: number | null }, right: typeof left) =>
  (right.share ?? -1) - (left.share ?? -1) || left.id.localeCompare(right.id)

export function useSeenAccounts(now: () => Date = () => new Date()) {
  const organizations = ref<SeenOrganization[]>([])
  const state = ref<'failed' | 'loading' | 'ready'>('loading')

  async function read() {
    state.value = 'loading'
    const today = now()
    const utcOffset = -today.getTimezoneOffset()
    // By the calendar, not by 24 hours, so a change of the clock moves no day.
    const day = (offset: number) =>
      localDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset))
    try {
      const [usage, quota] = await Promise.all([
        fetchUsage({
          from: day(1 - SEEN_DAYS),
          to: day(1),
          utcOffset,
          groupBy: ['seat'],
          filters: {},
          compare: false,
        }),
        fetchQuota(utcOffset),
      ])
      const whole = usage.total.agent_seconds
      const found = new Map<string, SeenOrganization>()
      const organizationOf = (id: string) => {
        const known = found.get(id)
        if (known) return known
        const added: SeenOrganization = { id, share: null, accounts: [] }
        found.set(id, added)
        return added
      }
      const place = (account: SeenAccount) => {
        const read = readAccountId(account.id)
        if (!read) return
        const organization = organizationOf(read.organization)
        if (read.kind === 'unplaced') return
        const listed = organization.accounts.find((one) => one.id === account.id)
        if (listed) {
          listed.weeklyReset ??= account.weeklyReset
          listed.shared ||= account.shared
        } else organization.accounts.push(account)
      }
      for (const row of usage.rows) {
        const seat = row.group.seat
        if (!seat?.id) continue
        const share = whole > 0 ? row.agent_seconds / whole : 0
        const organization = organizationOf(readAccountId(seat.id)?.organization ?? seat.id)
        organization.share = (organization.share ?? 0) + share
        place({
          id: seat.id,
          weeklyReset: seat.weekly_reset ?? null,
          shared: seat.shared ?? false,
          share,
        })
      }
      for (const account of quota.accounts)
        place({
          id: account.account,
          weeklyReset: account.weekly_reset,
          shared: account.shared,
          share: null,
        })
      organizations.value = [...found.values()]
        .map((organization) => ({
          ...organization,
          accounts: [...organization.accounts].sort(bySpent),
        }))
        .sort(bySpent)
      state.value = 'ready'
    } catch {
      state.value = 'failed'
    }
  }

  onMounted(read)

  return {
    organizations: computed(() => organizations.value),
    read,
    state: computed(() => state.value),
  }
}
