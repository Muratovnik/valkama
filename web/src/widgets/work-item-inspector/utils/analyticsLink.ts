/**
 * The way from an item's Agents tab to the same work on the Analytics page. The tab's figures
 * cover every item its read lists — the item alone, or an epic with its children — over all the
 * time that work took, so the link filters the page to all of them and sets its period to the
 * days from the first of that work to the last, and the page adds up to what the tab says. An
 * address holds only so much: when those items do not fit in it, the link filters to the item
 * alone and says that it opens the item's own work, since the page will then show less than the
 * tab.
 */
import {
  addressFits,
  analyticsPageAddress,
  DEFAULT_VIEW,
  localDay,
} from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'

export interface ItemAnalyticsLink {
  href: string
  /** The page shows the item's own work only, and not everything the tab's figures cover. */
  ownOnly: boolean
}

/** The days the tab's work spans, in the browser's calendar; the page's own period for no work. */
function spanned(stretches: ItemUsage['account_stretches']): Partial<AnalyticsView> {
  if (!stretches.length) return {}
  const first = Math.min(...stretches.map((stretch) => Date.parse(stretch.started_at)))
  const last = Math.max(...stretches.map((stretch) => Date.parse(stretch.ended_at)))
  return { period: 'custom', from: localDay(new Date(first)), to: localDay(new Date(last)) }
}

export function itemAnalyticsLink(
  usage: Pick<ItemUsage, 'account_stretches' | 'by_item' | 'work_item_id'>,
): ItemAnalyticsLink {
  const covered = [
    ...new Set([
      usage.work_item_id,
      ...usage.by_item.flatMap((line) => (line.work_item_id === null ? [] : [line.work_item_id])),
    ]),
  ]
  const period = { ...DEFAULT_VIEW, ...spanned(usage.account_stretches) }
  const whole = { ...period, filters: { work_item: covered } }
  if (addressFits(whole)) return { href: analyticsPageAddress(whole), ownOnly: false }
  return {
    href: analyticsPageAddress({ ...period, filters: { work_item: [usage.work_item_id] } }),
    ownOnly: true,
  }
}
