import { lazyView } from '@/shared/ui/lazyView.ts'

/**
 * The questions themselves, downloaded when the dialog first opens.
 *
 * The rail's count is the hub's and stays with the first screen; the list that
 * answers it is drawn only in the open dialog, which reads the questions again as
 * it opens, so the download runs beside that read rather than before the board.
 */
export const requestListView = lazyView(
  () => import('@/features/input-requests/components/RequestList.vue'),
)
