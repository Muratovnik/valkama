import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import { lazyView } from '@/shared/ui/lazyView.ts'

/**
 * Settings, Analytics, Agent decisions and Volumes are places the operator visits rather than
 * works in, so the shell downloads each when it is asked for instead of with the board.
 */
export const settingsView = lazyView(() => import('@/pages/settings/SettingsView.vue'))
export const analyticsView = lazyView(() => import('@/pages/analytics/AnalyticsView.vue'))
export const decisionsView = lazyView(() => import('@/pages/decisions/DecisionsView.vue'))
export const volumesView = lazyView(() => import('@/pages/volumes/VolumesView.vue'))

/**
 * Start downloading a destination's code before it is drawn.
 *
 * The rail calls this when a destination is hovered or focused, and the shell
 * when the address names one, so arriving there does not wait on the network.
 * Planning is the first screen and is already resident.
 */
export function prefetchModule(module: ModuleId) {
  if (module === 'settings') settingsView.prefetch()
  if (module === 'analytics') analyticsView.prefetch()
  if (module === 'decisions') decisionsView.prefetch()
  if (module === 'volumes') volumesView.prefetch()
}
