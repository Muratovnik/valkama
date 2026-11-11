/**
 * The Analytics page counts each opening once, and a count that cannot be written costs
 * the person nothing: no error, no wait, no unhandled rejection.
 */
import { createI18n } from 'vue-i18n'

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AppModuleStage from '@/app/components/AppModuleStage.vue'

import AnalyticsView from '@/pages/analytics/AnalyticsView.vue'

import { reportAnalyticsUse } from '@/shared/api/analyticsUses.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { usageAnswer } from '../fixtures/analytics.ts'

const USES = '/api/analytics/uses'
const GLOBAL = { kind: 'global' as const }
const PROJECT = { kind: 'project' as const, project_ref: { project_id: 'sample' } }

function i18n() {
  return createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages, pluralRules })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

/** A period that spent nothing: the page's own read, answered so that only a count can fail. */
const nothingSpent = () =>
  usageAnswer({ first: new Date(2026, 10, 9), days: 1, groupBy: ['work_item'], stretches: [] })

/** The server: grants a session, answers the page's read, and answers a count as `count` says. */
function serve(count: () => Promise<Response> = async () => json({ use: {} })) {
  const reports: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      if (input === '/api/security/bootstrap') return json({ session_token: 'x'.repeat(64) })
      if (input === USES && init?.method === 'POST') {
        reports.push(JSON.parse(init.body as string))
        return count()
      }
      return typeof input === 'string' && input.startsWith('/api/analytics/usage')
        ? json(nothingSpent())
        : new Response('{}', { status: 404 })
    }),
  )
  return reports
}

/** Every rejection nobody handled while the test ran. */
function unhandled() {
  const seen: unknown[] = []
  const listener = (reason: unknown) => seen.push(reason)
  process.on('unhandledRejection', listener)
  afterEach(() => {
    process.off('unhandledRejection', listener)
  })
  return seen
}

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('an opening of the Analytics page', () => {
  it('is reported once per navigation, not per render or refetch', async () => {
    const reports = serve()
    const stage = mount(AppModuleStage, {
      props: {
        activeModule: 'analytics',
        context: null,
        locale: 'en',
        moduleTitle: 'Analytics',
        primaryWriteScopeId: null,
        questionAsked: false,
        route: { module_id: 'analytics', scope: GLOBAL },
        scope: GLOBAL,
        stateBytes: 2048,
      },
      global: { plugins: [i18n()] },
    })
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(stage.find('.analytics-page').exists()).toBe(true)
    expect(reports).toEqual([{ kind: 'page_open', utc_offset: -new Date().getTimezoneOffset() }])

    // Moving between scopes of the page redraws it and is no new opening.
    await stage.setProps({ route: { module_id: 'analytics', scope: PROJECT }, scope: PROJECT })
    await stage.setProps({ locale: 'ru' })
    await flushPromises()
    expect(reports).toHaveLength(1)
  })

  it('reports again only when the page is opened again', async () => {
    const reports = serve()
    const page = mount(AnalyticsView, { global: { plugins: [i18n()] } })
    await flushPromises()
    // Another view of the page, read again, is the same opening.
    await page.setProps({ routeState: { by: 'model' } })
    await page.setProps({ routeState: undefined })
    await flushPromises()
    expect(reports).toHaveLength(1)

    page.unmount()
    mount(AnalyticsView, { global: { plugins: [i18n()] } })
    await flushPromises()
    expect(reports.map((report) => (report as { kind: string }).kind)).toEqual([
      'page_open',
      'page_open',
    ])
  })
})

describe('a report that cannot be written', () => {
  const rejections = unhandled()

  it.each([
    ['the network fails', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['the server fails', async () => json({ error: { code: 'request_failed' } }, 500)],
    ['the server refuses it', async () => json({ error: { code: 'invalid_request' } }, 400)],
  ])('is dropped without a word when %s', async (_name, count) => {
    const reports = serve(count)
    const page = mount(AnalyticsView, { global: { plugins: [i18n()] } })
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reports).toHaveLength(1)
    expect(page.find('.analytics-page').exists()).toBe(true)
    expect(page.find('[role="alert"]').exists()).toBe(false)
    expect(rejections).toEqual([])
  })

  it('is dropped when even the session cannot be had', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    expect(reportAnalyticsUse('task_open')).toBeUndefined()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rejections).toEqual([])
  })

  it('never makes the page wait for its answer', async () => {
    const reports = serve(() => new Promise<Response>(() => {}))
    const page = mount(AnalyticsView, { global: { plugins: [i18n()] } })
    await flushPromises()
    expect(reports).toHaveLength(1)
    expect(page.get('[role="status"]').text()).toContain('Nothing was spent in this period')
  })
})
