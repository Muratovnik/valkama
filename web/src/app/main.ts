import { createPinia } from 'pinia'
/**
 * Application entry.
 *
 * `src` has three roots and imports run in one direction only:
 *
 *   app/      the shell that composes modules: navigation, module frame, this
 *             entry. It may import from anywhere.
 *   modules/  one folder per platform module — planning, sessions, analytics,
 *             improvements, skills, settings. A module owns what only it uses
 *             and never reaches into another module.
 *   shared/   what more than one module imports: api, platform contracts, ui
 *             primitives, composables, lib, i18n, types, styles. It imports
 *             nothing from app/ or modules/.
 *
 * Placement follows the import graph, not a template: when a second module
 * starts importing something, it moves to shared/.
 */
import { createApp } from 'vue'

import App from '@/app/App.vue'
import '@fontsource-variable/inter'

import { router } from '@/app/router.ts'

import { i18n } from '@/shared/i18n/index'
import '@/app/styles/index.css'

document.documentElement.lang = i18n.global.locale.value
createApp(App).use(createPinia()).use(router).use(i18n).mount('#app')
