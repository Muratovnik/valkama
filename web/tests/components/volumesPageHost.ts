/**
 * The Volumes page mounted under a shell of its own, against a double of the server's read
 * (`volumesDouble`): the shell writes back the address the page gives it, keeps the boards the
 * page opened (`went`) and counts the times it asked for the questions window (`questions`).
 */
import { defineComponent, h, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { vi } from 'vitest'

import VolumesView from '@/pages/volumes/VolumesView.vue'

import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'

import { VOLUMES_STORE } from '../support/volumesDouble.ts'
import type { volumesDouble } from '../support/volumesDouble.ts'

/** A Wednesday afternoon, two days and six hours after the double's oldest cards and question. */
export const NOW = new Date('2026-03-03T15:00:00Z')

const MAIN = { data_scope_id: VOLUMES_STORE, space_key: 'MAIN' }
export const SPACE: OperatingScope = { kind: 'space', space_ref: MAIN }
export const PROJECT: OperatingScope = {
  kind: 'space',
  space_ref: MAIN,
  project_ref: { project_id: 'alpha' },
}
export const GLOBAL: OperatingScope = { kind: 'global' }

type Double = ReturnType<typeof volumesDouble>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

/** The server: the double's read, failed for the first `fail` reads. */
function serve(double: Double, fail = 0) {
  let failed = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input as string, 'http://valkama.test')
      if (url.pathname === '/api/security/bootstrap') return json({ session_token: 'x'.repeat(64) })
      if (url.pathname !== '/api/planning/volumes') return json({}, 404)
      if (failed < fail) {
        failed += 1
        return json({ error: { code: 'unavailable', message: 'busy' } }, 503)
      }
      return json(double.read(url.searchParams))
    }),
  )
}

/** What the page asked of the shell: the boards it opened, and the questions window. */
export const went: PlatformRoute[] = []
export const shell = { questions: 0 }

/** The page in `locale` under a shell of its own, which writes back the address it is given. */
export function mountPage(
  double: Double,
  scope: OperatingScope = SPACE,
  options: { fail?: number; locale?: 'en' | 'ru'; state?: Record<string, string> } = {},
) {
  serve(double, options.fail)
  const i18n = createI18n({
    legacy: false,
    locale: options.locale ?? 'en',
    fallbackLocale: 'en',
    messages,
    pluralRules,
  })
  const Shell = defineComponent({
    setup() {
      const state = ref<Record<string, string>>(options.state ?? {})
      provideReferenceLinks((reference) => ({
        title: reference.value,
        href: `/open/${reference.value}`,
        open: () => {},
      }))
      return () =>
        h(VolumesView, {
          scope,
          routeState: state.value,
          onState: (next: Record<string, string>) => (state.value = next),
          onGo: (route: PlatformRoute) => went.push(route),
          onRequests: () => (shell.questions += 1),
        })
    },
  })
  return mount(Shell, { global: { plugins: [i18n] }, attachTo: document.body })
}

export type Page = ReturnType<typeof mountPage>
export const number = (page: Page, key: string) => page.get(`[data-number="${key}"]`)
const goal = (page: Page, reference: string) => page.get(`tr[data-reference="${reference}"]`)
export const figure = (page: Page, reference: string, key: string) =>
  goal(page, reference).get(`[data-figure="${key}"]`)

/** Forget what the shell was asked, for the next test. */
export function forgetShell() {
  went.length = 0
  shell.questions = 0
}
