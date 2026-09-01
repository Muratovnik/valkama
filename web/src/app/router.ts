import { h } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

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
