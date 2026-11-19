import { defineComponent, h, ref } from 'vue'
/**
 * The Agent decisions page against a double of the server's summary (`decisionsDouble`). The
 * oracle is the page's contract in DESIGN.md: the scope is the context bar's, the point and the
 * period narrow the read, a long period is read in pages of 200 and drawn whole in one table, an
 * empty period says so, a first read that fails is the shared error panel with its retry, and a
 * row's card is a link to the card.
 */
import { createI18n } from 'vue-i18n'

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import DecisionsView from '@/pages/decisions/DecisionsView.vue'

import type { Decision } from '@/shared/api/decisionsApi.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

import { decisionsBack, decisionsDouble } from '../support/decisionsDouble.ts'

/** A Wednesday afternoon in the browser's own time, the moment every read is asked at. */
const NOW = new Date(2030, 2, 6, 15, 0, 0)
/** An hour before it, where the newest decision of a fixture stands. */
const NEWEST = new Date(2030, 2, 6, 14, 0, 0)

type Double = ReturnType<typeof decisionsDouble>

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

/** The server: the double's summary, failed for the first `fail` reads. */
function serve(double: Double, fail = 0) {
  let failed = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input as string, 'http://valkama.test')
      if (url.pathname === '/api/security/bootstrap') return json({ session_token: 'x'.repeat(64) })
      if (url.pathname !== '/api/planning/decisions') return json({}, 404)
      if (failed < fail) {
        failed += 1
        return json({ error: { code: 'unavailable', message: 'busy' } }, 503)
      }
      return json(double.read(url.searchParams))
    }),
  )
}

/** The references a plain press opened, in order. */
const opened: string[] = []

/**
 * The page in `locale` under a shell of its own: the address the page writes is the route state
 * it is given next, and a reference opens by being kept in `opened`.
 */
function mountPage(
  double: Double,
  scope: { projectId?: string | null; space?: string | null } = { space: 'MAIN' },
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
        open: () => opened.push(reference.value),
      }))
      return () =>
        h(DecisionsView, {
          ...scope,
          routeState: state.value,
          onState: (next: Record<string, string>) => (state.value = next),
        })
    },
  })
  return mount(Shell, { global: { plugins: [i18n] }, attachTo: document.body })
}

type Page = ReturnType<typeof mountPage>
const rows = (page: Page) => page.findAll('tbody tr[data-event]')
const events = (page: Page) => rows(page).map((row) => row.attributes('data-event'))

/** Chooses a point, or every point, in the bar's filter. */
async function choosePoint(page: Page, value: string) {
  page.getComponent(ChoiceSelect).vm.$emit('update:modelValue', value)
  await flushPromises()
}

/** One decision at `at`, on the card `MAIN-<event>`. */
function decisionAt(at: Date, event: number): Decision {
  const [one] = decisionsBack(1, at)
  return { ...one, event_id: event, item: { ...one.item, reference: `MAIN-${event}` } }
}

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  opened.length = 0
})

describe('the Agent decisions page', () => {
  it('reads the context bar’s space and project, newest first, and counts the decisions', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const double = decisionsDouble(decisionsBack(50, NEWEST))
    const page = mountPage(double, { space: 'MAIN', projectId: 'alpha' })
    await flushPromises()

    const [asked] = double.asked
    expect(asked.get('space')).toBe('MAIN')
    expect(asked.get('project')).toBe('alpha')
    expect(asked.getAll('point')).toEqual([])
    expect(events(page)).toEqual(Array.from({ length: 50 }, (_, index) => String(50 - index)))
    expect(page.text()).toContain('50 decisions')
  })

  it('asks every space and no project where the context bar stands at the top', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const double = decisionsDouble(decisionsBack(3, NEWEST))
    const page = mountPage(double, { space: null, projectId: null })
    await flushPromises()

    expect(rows(page)).toHaveLength(3)
    expect(double.asked[0].has('space')).toBe(false)
    expect(double.asked[0].has('project')).toBe(false)
  })

  it('narrows the read to the point chosen, and back to every point', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const double = decisionsDouble(decisionsBack(50, NEWEST))
    const page = mountPage(double)
    await flushPromises()

    await choosePoint(page, 'goal_close')
    expect(double.asked.at(-1)?.getAll('point')).toEqual(['goal_close'])
    // Fifty decisions with the ten points in turn: five of them closed a goal.
    expect(rows(page)).toHaveLength(5)
    expect(rows(page).every((row) => row.text().includes('Goal closed'))).toBe(true)

    await choosePoint(page, 'all')
    expect(double.asked.at(-1)?.getAll('point')).toEqual([])
    expect(rows(page)).toHaveLength(50)
  })

  it('narrows the read to the period chosen, from its first moment to now', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    // Today's decision, and one on the Sunday before this week's Monday.
    const double = decisionsDouble([
      decisionAt(new Date(2030, 2, 6, 9, 0), 2),
      decisionAt(new Date(2030, 2, 3, 9, 0), 1),
    ])
    const page = mountPage(double)
    await flushPromises()

    const [week] = double.asked
    expect(Date.parse(week.get('from') ?? '')).toBe(new Date(2030, 2, 4).getTime())
    expect(Date.parse(week.get('to') ?? '')).toBe(NOW.getTime())
    expect(events(page)).toEqual(['2'])

    page.getComponent(SegmentedControl).vm.$emit('update:modelValue', 'weeks4')
    await flushPromises()
    const weeks = double.asked.at(-1)
    expect(Date.parse(weeks?.get('from') ?? '')).toBe(new Date(2030, 1, 7).getTime())
    expect(events(page)).toEqual(['2', '1'])
  })

  it('reads a custom period’s days whole, from the first one’s midnight to the last one’s end', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const double = decisionsDouble(decisionsBack(3, NEWEST))
    mountPage(double, undefined, {
      state: { period: 'custom', from: '2030-03-01', to: '2030-03-02' },
    })
    await flushPromises()

    const [asked] = double.asked
    expect(Date.parse(asked.get('from') ?? '')).toBe(new Date(2030, 2, 1).getTime())
    expect(Date.parse(asked.get('to') ?? '')).toBe(new Date(2030, 2, 2, 23, 59, 59).getTime())
  })

  it('reads a long period page by page of 200 and draws its thousand decisions in one table', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const double = decisionsDouble(decisionsBack(1000, NEWEST))
    const page = mountPage(double, undefined, { state: { period: 'weeks4' } })
    await flushPromises()

    expect(double.asked.map((query) => [query.get('limit'), query.get('offset')])).toEqual([
      ['200', '0'],
      ['200', '200'],
      ['200', '400'],
      ['200', '600'],
      ['200', '800'],
    ])
    expect(rows(page)).toHaveLength(1000)
    expect(new Set(events(page)).size).toBe(1000)
    expect(page.text()).toContain('1000 decisions')
  })

  it('says an empty period in the page’s words, in Russian too', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const english = mountPage(decisionsDouble([]))
    await flushPromises()
    expect(english.text()).toContain('The agents decided nothing on their own in this period')
    expect(english.find('table').exists()).toBe(false)
    english.unmount()

    const russian = mountPage(decisionsDouble([]), undefined, { locale: 'ru' })
    await flushPromises()
    expect(russian.text()).toContain('За период агенты ничего не решали сами')
  })

  it('shows a first read that failed in the shared error panel, and the decisions once retried', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const page = mountPage(decisionsDouble(decisionsBack(4, NEWEST)), undefined, { fail: 1 })
    await flushPromises()

    const panel = page.get('.platform-state-panel')
    expect(panel.attributes('role')).toBe('alert')
    expect(panel.text()).toContain('Could not read the decisions.')
    expect(page.find('table').exists()).toBe(false)

    await page.get('.platform-state-retry').trigger('click')
    await flushPromises()
    expect(rows(page)).toHaveLength(4)
  })

  it('links a row’s card to the card, which a plain press opens in place', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    const page = mountPage(decisionsDouble(decisionsBack(2, NEWEST)))
    await flushPromises()

    const link = rows(page)[0].get('a')
    expect(link.attributes('href')).toBe('/open/MAIN-1')
    await link.trigger('click', { button: 0 })
    expect(opened).toEqual(['MAIN-1'])
  })
})
