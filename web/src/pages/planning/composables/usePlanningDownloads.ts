import { watch } from 'vue'
import type { Ref } from 'vue'

import type { PlanningViewMode } from '@/pages/planning/PlanningWorkspace.vue'
import { graphView } from '@/pages/planning/utils/graphView.ts'
import { inspectorView } from '@/pages/planning/utils/inspectorView.ts'

import type { PlanningReadModel } from '@/shared/api/planningModel.ts'

/**
 * When the Planning surface starts downloading the code its first frame does not draw.
 *
 * An address that opens on the graph downloads it beside the space read, not after it.
 * The card downloads once the board stands and the page is idle: opening one is the
 * board's first action, and the card's own reads should not wait on its code. An address
 * that names a card mounts it beside the space read, which starts the download then.
 */
export function usePlanningDownloads(
  view: Readonly<Ref<PlanningViewMode>>,
  model: Readonly<Ref<PlanningReadModel | null>>,
) {
  watch(view, (mode) => mode === 'graph' && graphView.prefetch(), { immediate: true })
  watch(model, (board) => board !== null && inspectorView.prefetchWhenIdle(), { immediate: true })
}
