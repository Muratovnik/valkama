import { lazyView } from '@/shared/ui/lazyView.ts'

/**
 * The graph view, downloaded when the operator is about to open it.
 *
 * It carries Vue Flow, which neither the board nor the list draws, so the first
 * screen does not download it. The Planning surface starts the download
 * when the address already names the graph, so a link straight to it does not
 * wait for the space to be read first; the workspace starts it on intent.
 */
export const graphView = lazyView(
  () => import('@/widgets/work-item-graph/components/GraphView.vue'),
)
