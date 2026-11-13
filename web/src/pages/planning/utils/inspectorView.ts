import InspectorWaitFrame from '@/widgets/work-item-inspector/components/InspectorWaitFrame.vue'

import { lazyView } from '@/shared/ui/lazyView.ts'

/**
 * The card, downloaded once the board is drawn rather than with it.
 *
 * The board's first frame shows no card, and the card's code is the largest part
 * of the page that frame does not draw. Opening a card is still the board's first
 * action, so the Planning surface starts the download as soon as the board stands
 * (`usePlanningDownloads`). Opened before the code has arrived, the card's wait
 * stands in the frame the card draws while its record is read, so the dots stand
 * where the card's own wait will.
 */
export const inspectorView = lazyView(
  () => import('@/widgets/work-item-inspector/components/WorkItemInspector.vue'),
  { frame: InspectorWaitFrame },
)

/** What the surface draws in the card's place. */
export const WorkItemInspector = inspectorView.component
