import { lazyView } from '@/shared/ui/lazyView.ts'

/**
 * The card, downloaded once the board is drawn rather than with it.
 *
 * The board's first frame shows no card, and the card's code is the largest part
 * of the page that frame does not draw. Opening a card is still the board's first
 * action, so the Planning surface starts the download as soon as the board stands
 * (`usePlanningDownloads`).
 */
export const inspectorView = lazyView(
  () => import('@/widgets/work-item-inspector/components/WorkItemInspector.vue'),
)

/** What the surface draws in the card's place. */
export const WorkItemInspector = inspectorView.component
