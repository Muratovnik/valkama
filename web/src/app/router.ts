import { h } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import { isPlatformRouteUnavailable, resolvePlatformRoute } from '@/shared/api/platformRoute.ts'
import { mayLeave } from '@/shared/lib/leaveGuard.ts'

/**
 * The router owns history, the back button and entry restoration. It does not
 * own the URL grammar: `platformRoute` parses and serializes the canonical
 * `/modules/<module>/<scope>` form, and it stays the only place that knows it.
 *
 * Hence one catch-all record. Registering a matcher per module would put the
 * grammar in two places, and the two would drift the first time a parameter is
 * added. The shell renders the active module itself, so the record's component
 * is empty by design.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/:modulePath(.*)*',
    name: 'modules',
    component: { render: () => h('template') },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * Where a location takes the operator, without the module's own view state.
 *
 * A view switch rewrites only `state` and keeps whatever is open, so it never
 * needs to ask. Anything the grammar cannot read is compared as written.
 */
function destination(fullPath: string): string {
  try {
    const route = resolvePlatformRoute(new URL(fullPath, location.origin))
    return isPlatformRouteUnavailable(route)
      ? fullPath
      : JSON.stringify({ ...route, state: undefined })
  } catch {
    return fullPath
  }
}

/**
 * Leaving an open item with unsaved work asks first, whoever started the move:
 * Back and Forward, global search, any route the shell writes. The inspector asks for the
 * departures it owns itself; this is every other one. A refused move keeps the
 * URL where it was — for Back and Forward the router steps history back.
 */
router.beforeEach(
  (to, from) => destination(to.fullPath) === destination(from.fullPath) || mayLeave(),
)
