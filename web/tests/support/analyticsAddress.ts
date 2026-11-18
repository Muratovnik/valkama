/**
 * The Analytics page's view through its whole address, as a reload or a pasted link takes it: the
 * module's state, the URL the shell writes and the manifest's check of what it reads back.
 */
import { readAddress, writeAddress } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import {
  isPlatformRouteUnavailable,
  resolvePlatformRoute,
  serializePlatformRoute,
  validateManifestRouteState,
} from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

const analytics = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'analytics')

/** Through the whole address: the module's state, the URL the shell writes, and back. */
export function throughTheAddress(view: AnalyticsView): AnalyticsView {
  const route: PlatformRoute = {
    module_id: 'analytics',
    scope: { kind: 'global' },
    state: writeAddress(view),
  }
  const back = resolvePlatformRoute(new URL(serializePlatformRoute(route), 'http://127.0.0.1'))
  if (isPlatformRouteUnavailable(back)) throw new Error('the address did not resolve')
  if (!analytics) throw new Error('no analytics manifest')
  return readAddress(validateManifestRouteState(analytics, back.state ?? {}))
}
