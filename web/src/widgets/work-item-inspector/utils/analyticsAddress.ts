import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

/**
 * The Analytics page filtered to one work item, in the route form every page is opened by. Its
 * state carries the usage read's own parameter, `work_item`, with the item's id: the page reads
 * its state from the address under the names the read takes. Global, since an item's work is
 * counted to it whichever project the page would otherwise be scoped to.
 */
export function itemAnalyticsAddress(workItemId: string): string {
  return serializePlatformRoute({
    module_id: 'analytics',
    scope: { kind: 'global' },
    state: { work_item: workItemId },
  })
}
