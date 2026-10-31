import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import { lazyView } from '@/shared/ui/lazyView.ts'

/**
 * Settings is a place the operator visits rather than works in, so the shell
 * downloads it when it is asked for instead of with the board.
 */
export const settingsView = lazyView(() => import('@/pages/settings/SettingsView.vue'))

/**
 * Start downloading a destination's code before it is drawn.
 *
 * The rail calls this when a destination is hovered or focused, and the shell
 * when the address names one, so arriving there does not wait on the network.
 * Planning is the first screen and is already resident.
 */
export function prefetchModule(module: ModuleId) {
  if (module === 'settings') settingsView.prefetch()
}
