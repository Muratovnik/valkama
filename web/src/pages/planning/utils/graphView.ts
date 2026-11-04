import { lazyView } from '@/shared/ui/lazyView.ts'

/**
 * The graph view, downloaded when the operator is about to open it.
 *
 * It carries Vue Flow, which neither the board nor the list draws, so the first
 * screen does not download it. The Planning surface starts the download
 * when the address already names the graph, so a link straight to it does not
 * wait for the space to be read first; the workspace starts it on intent.
 *
 * The same moment starts the graph's layout worker (`graphLayoutWarm`): the
 * worker loads ELK, a download of its own the first layout would otherwise
 * wait for after the space was read.
 */
const view = lazyView(() => import('@/widgets/work-item-graph/components/GraphView.vue'))

export const graphView: typeof view = {
  ...view,
  prefetch() {
    view.prefetch()
    import('@/widgets/work-item-graph/utils/graphLayoutWarm.ts').then(
      (warm) => warm.warmGraphLayout(),
      () => {
        // Without a warm worker the graph starts its own, as it always could.
      },
    )
  },
}
