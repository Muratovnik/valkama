/**
 * The Analytics page against a stand-in for its read: every query it asks is kept, and each is
 * answered by the test's own function, a status, or not at all until the test lets it go.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { vi } from 'vitest'

import AnalyticsView from '@/pages/analytics/AnalyticsView.vue'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

/** `answer` gives a body, `{ status }` for a refusal, or `'hold'` to keep the read waiting. */
export function stubAnalyticsReads(answer: (query: URLSearchParams) => unknown) {
  const asked: URLSearchParams[] = []
  const held: (() => void)[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input as string, 'http://127.0.0.1')
      if (url.pathname !== '/api/analytics/usage') return new Response('{}', { status: 404 })
      asked.push(url.searchParams)
      const given = answer(url.searchParams)
      if (given === 'hold')
        return new Promise<Response>((resolve) => held.push(() => resolve(new Response('{}'))))
      if (
        given &&
        typeof given === 'object' &&
        'status' in given &&
        typeof given.status === 'number'
      )
        return new Response('{}', { status: given.status })
      return new Response(JSON.stringify(given), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
  /** The reads by what they were grouped by: the page's own, and each filter's values. */
  const grouped = (dimension: string) =>
    asked.filter((query) => query.get('group_by') === dimension)
  return { asked, grouped, held }
}

function analyticsI18n(locale: 'en' | 'ru' = 'en') {
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
