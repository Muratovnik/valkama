/**
 * What the quota's tiles and panel take from the quota read: each section's windows of an
 * account, and the tightest of them across accounts.
 *
 * A section of the quota is its five hours, or its week with each model's week beside it. A
 * window counts toward the tightest only while it stands: its reset is still ahead, or it has
 * named none. Of those the tightest is the one most spent, a fresh one before a silent one at the
 * same share, then the first in the answer's order. Its figure is one account's share of one
 * window, said as it is: nothing here adds two windows or two accounts.
 */
import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import { isShareWindow } from '@/shared/api/analyticsApi.ts'
import type {
  Quota,
  QuotaAccount,
  QuotaShareWindow,
  QuotaWindow,
} from '@/shared/api/analyticsApi.ts'

/** The windows a section of the quota shows. */
const SECTION_KINDS: Record<QuotaSection, readonly QuotaShareWindow['kind'][]> = {
  quota_five_hour: ['five_hour'],
  quota_week: ['week', 'week_model'],
}

/** An account's windows of a section, in the answer's order: the week, then each model's. */
export const sectionWindows = (account: QuotaAccount, section: QuotaSection) =>
  account.windows
    .filter(isShareWindow)
    .filter((window) => SECTION_KINDS[section].includes(window.kind))

/** An account's windows of money spent past a limit, which carry a state and no figure. */
export const spendWindows = (account: QuotaAccount) =>
  account.windows.filter((window) => !isShareWindow(window))

/** Whether a window still stands at `now` (ms): its reset ahead, or none named. */
export const stands = (window: QuotaWindow, now: number) =>
  window.resets_at === null || Date.parse(window.resets_at) > now

/** One window of one account. */
export interface QuotaPick {
  account: QuotaAccount
  window: QuotaShareWindow
}

/** The window of a section most spent across accounts at `now`, or null where none stands. */
export function tightest(quota: Quota, section: QuotaSection, now: number): QuotaPick | null {
  let found: QuotaPick | null = null
  for (const account of quota.accounts)
    for (const window of sectionWindows(account, section)) {
      if (!stands(window, now)) continue
      const used = window.latest.used_percent
      const best = found?.window
      const tighter =
        !best ||
        used > best.latest.used_percent ||
        (used === best.latest.used_percent && window.state === 'fresh' && best.state !== 'fresh')
      if (tighter) found = { account, window }
    }
  return found
}

/** A window's key among an account's: its kind, and a model's week by its model. */
export const windowKey = (window: QuotaWindow) =>
  window.model === null ? window.kind : `${window.kind}:${window.model}`

/** An account's key among the answer's: its organization and its account or its seat. */
export const accountKey = (account: QuotaAccount) =>
  [account.organization, account.account_uuid ?? account.seat ?? ''].join('/')
