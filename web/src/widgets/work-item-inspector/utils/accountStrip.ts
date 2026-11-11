import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'
import { seriesSlots } from '@/shared/lib/seriesColors.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'

type Stretch = ItemUsage['account_stretches'][number]
type Account = ItemUsage['accounts'][number]['account']

/** What tells one account from another on the card; an unknown one is its own. */
const accountKey = (account: Account) => (account.unknown ? '' : (account.id ?? ''))

/**
 * The item's stretches of work by account as one strip: in time order, each as long as its share
 * of the agents' time, in the hue `seriesSlots()` pins to its account (the whole domain the read
 * names, so a reload repaints nothing) and the neutral for an unknown one. A strip of stretches
 * that took no time gives each the same room, so a change still stands where it happened.
 *
 * Each part says where it starts and how much of the strip it takes, from 0 to 1. Neighbouring
 * stretches differ in organization, but only some of them are a change: one stands where work
 * under a known organization follows work under a different known one, numbered in time order at
 * the share of the strip where the later one starts. A stretch whose organization nobody recorded
 * is neither a change nor hides one, so the known work on either side of it is compared across
 * it. `first` is the known organization the work starts under, which the first change leaves.
 */
export function accountStrip(stretches: readonly Stretch[], accounts: readonly Account[]) {
  const slots = seriesSlots(
    accounts.filter((account) => !account.unknown).map((account) => accountKey(account)),
  )
  const slotOf = (account: Account): SeriesSlot =>
    account.unknown ? 'other' : (slots.get(accountKey(account)) ?? 'other')
  const total = stretches.reduce((sum, stretch) => sum + stretch.seconds, 0)
  let reached = 0
  const parts = stretches.map((stretch, index) => {
    const size = total > 0 ? stretch.seconds / total : 1 / stretches.length
    const part = {
      key: `${index}:${accountKey(stretch.account)}`,
      account: stretch.account,
      at: stretch.started_at,
      start: reached,
      size,
      slot: slotOf(stretch.account),
    }
    reached += size
    return part
  })
  const known = parts.filter((part) => !part.account.unknown)
  const changes = known
    .filter(
      (part, index) =>
        index > 0 && accountKey(part.account) !== accountKey(known[index - 1].account),
    )
    .map((part, index) => ({ ...part, number: index + 1 }))
  return { parts, changes, first: known.at(0)?.account, slotOf }
}
