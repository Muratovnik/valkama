/**
 * The way from an item's Agents tab to the same work on the Analytics page. The tab's figures
 * cover every item its read lists — the item alone, or an epic with its children — so the link
 * filters the page to all of them, and the page adds up to what the tab says. An address holds
 * only so much: when those items do not fit in it, the link filters to the item alone and says
 * that it opens the item's own work, since the page will then show less than the tab.
 */
import { addressFits, analyticsPageAddress, DEFAULT_VIEW } from '@/shared/api/analyticsAddress.ts'
import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'

export interface ItemAnalyticsLink {
  href: string
  /** The page shows the item's own work only, and not everything the tab's figures cover. */
  ownOnly: boolean
}

export function itemAnalyticsLink(
  usage: Pick<ItemUsage, 'by_item' | 'work_item_id'>,
): ItemAnalyticsLink {
  const covered = [
    ...new Set([
      usage.work_item_id,
      ...usage.by_item.flatMap((line) => (line.work_item_id === null ? [] : [line.work_item_id])),
    ]),
  ]
  const whole = { ...DEFAULT_VIEW, filters: { work_item: covered } }
  if (addressFits(whole)) return { href: analyticsPageAddress(whole), ownOnly: false }
  return {
    href: analyticsPageAddress({ ...DEFAULT_VIEW, filters: { work_item: [usage.work_item_id] } }),
    ownOnly: true,
  }
}
