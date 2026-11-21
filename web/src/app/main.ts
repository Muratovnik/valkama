import { createPinia } from 'pinia'
/**
 * Application entry.
 *
 * `src` is laid out in Feature-Sliced Design layers — app, pages, widgets,
 * features, entities, shared — and a file imports only from a layer below its
 * own. `.agents/rules/web-architecture.md` holds the grammar, and
 * `npm run check:ui-system` holds the imports to it.
 */
import { createApp } from 'vue'

import App from '@/app/App.vue'
import '@fontsource-variable/inter'

import { router } from '@/app/router.ts'

import { i18n } from '@/shared/i18n/index'
import { quietFocusAfterPress } from '@/shared/lib/pressFocus.ts'
import '@/app/styles/index.css'

quietFocusAfterPress()
document.documentElement.lang = i18n.global.locale.value
createApp(App).use(createPinia()).use(router).use(i18n).mount('#app')
