/**
 * The Analytics page against a stand-in for its read: every query it asks is kept, and each is
 * answered by the test's own function, a status, or not at all until the test lets it go. The
 * quota read and the pauses read are each answered by a function of their own where the test gives
 * one, and refused where it does not, as a page with no such read stands.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { vi } from 'vitest'

import AnalyticsView from '@/pages/analytics/AnalyticsView.vue'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

/** A read kept waiting: what it asked, and how the test answers it — a body, or a status. */
interface HeldRead {
  query: URLSearchParams
  release: (answer: unknown) => void
}

const respond = (given: unknown) =>
  given && typeof given === 'object' && 'status' in given && typeof given.status === 'number'
    ? new Response(JSON.stringify('body' in given ? given.body : {}), { status: given.status })
    : new Response(JSON.stringify(given), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

/**
 * `answer` gives a body, `{ status }` for a refusal, `{ status, body }` for an answer of
 * another status, or `'hold'` to keep the read waiting;
 * `quota`, the quota read's body or `{ status }`, its query kept in `quotaAsked`; `pauses`, the
 * pauses read's body, `{ status }` or `'hold'`, its query kept in `pausesAsked`.
 */
export function stubAnalyticsReads(
  answer: (query: URLSearchParams) => unknown,
  quota?: (query: URLSearchParams) => unknown,
  pauses?: (query: URLSearchParams) => unknown,
) {
  const asked: URLSearchParams[] = []
  const quotaAsked: URLSearchParams[] = []
  const pausesAsked: URLSearchParams[] = []
  const held: HeldRead[] = []
  const answered = (query: URLSearchParams, given: unknown) =>
    given === 'hold'
      ? new Promise<Response>((resolve) =>
          held.push({ query, release: (later) => resolve(respond(later)) }),
        )
      : respond(given)
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input as string, 'http://127.0.0.1')
      if (url.pathname === '/api/analytics/quota' && quota) {
        quotaAsked.push(url.searchParams)
        return respond(quota(url.searchParams))
      }
      if (url.pathname === '/api/analytics/pauses' && pauses) {
        pausesAsked.push(url.searchParams)
        return answered(url.searchParams, pauses(url.searchParams))
      }
      if (url.pathname !== '/api/analytics/usage') return new Response('{}', { status: 404 })
      const query = url.searchParams
      asked.push(query)
      return answered(query, answer(query))
    }),
  )
  /** The reads by what they were grouped by: the page's own, and each filter's values. */
  const grouped = (dimension: string) =>
    asked.filter((query) => query.get('group_by') === dimension)
  return { asked, grouped, held, pausesAsked, quotaAsked }
}

export function analyticsI18n(locale: 'en' | 'ru' = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages, pluralRules })
}

export async function mountAnalytics(
  props: InstanceType<typeof AnalyticsView>['$props'] = {},
  locale: 'en' | 'ru' = 'en',
) {
  const page = mount(AnalyticsView, {
    props,
    attachTo: document.body,
    global: { plugins: [analyticsI18n(locale)] },
  })
  await flushPromises()
  return page
}
