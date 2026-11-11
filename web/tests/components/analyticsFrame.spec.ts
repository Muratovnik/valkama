/**
 * The frame of the Analytics page: a bar over a rail of sections and the panel of the one on show.
 * The oracle is the requirement. The rail lists the overview first and then each dimension the
 * page may filter on, the one on show marked as the page by more than its colour; choosing one is
 * written into the address, in place where rail and panel stand side by side, and as a new place
 * where a narrow screen shows one at a time, so Back returns to the list. The plain address is the
 * overview, which shows the figures, the days, what changed and the cards of first values; a
 * dimension shows its whole report. The bar names each filter set as a
 * chip that takes it out, offers every value from «add a filter», says how fresh the figures are
 * and reads them again.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'

import { momentAt, serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)

/** An hour on each of two tasks this Monday, under two models in two projects. */
const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 9, 10),
    group: { work_item: task(1, 'One'), model: value('model-a'), project: value('alpha') },
    spend: { seconds: 3600 },
  },
  {
    at: new Date(2026, 10, 9, 11),
    group: { work_item: task(2, 'Two'), model: value('model-b'), project: value('beta') },
    spend: { seconds: 3600 },
  },
]

/** A screen the width of a phone, as the page asks the window: under 1024 pixels wide. */
function narrowWindow() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('1024px'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

const written = (page: VueWrapper) =>
  page.emitted<[Record<string, string>, ('push' | 'replace')?]>('state') ?? []

const entries = (page: VueWrapper) => page.findAll('.analytics-rail-entry')
const entry = (page: VueWrapper, section: string) => page.get(`[data-section="${section}"]`)
const shown = (page: VueWrapper, selector: string) =>
  (page.get(selector).element as HTMLElement).style.display !== 'none'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the rail of sections', () => {
  it('lists the overview first, then every dimension, inside a navigation landmark', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics()
    expect(page.get('nav.analytics-rail').attributes('aria-label')).toBe('Sections of the usage')
    expect(entries(page).map((one) => one.text())).toEqual([
      'Overview',
      'Account',
      'Project',
      'Task',
      'Executor',
      'Role',
      'Launch class',
      'Model',
      'Effort',
      'Environment',
    ])
    expect(entries(page).map((one) => one.attributes('data-section'))).toEqual([
      'overview',
      ...USAGE_DIMENSIONS,
    ])
    // The plain address is the overview, where the page opens.
    expect(page.findAll('[aria-current="page"]').map((one) => one.text())).toEqual(['Overview'])
    expect(entry(page, 'overview').classes()).toContain('selected')
    // The rail replaced the breakdown's field: no field chooses a dimension any more.
    expect(page.text()).not.toContain('Break down by')
  })

  it('has no project entry at a project scope, where every figure is its project', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ projectId: 'alpha' })
    expect(entries(page).map((one) => one.attributes('data-section'))).toEqual([
      'overview',
      ...USAGE_DIMENSIONS.filter((dimension) => dimension !== 'project'),
    ])
  })

  it('marks the section of an address as the page, and writes a section chosen in place', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'model', measure: 'tokens' } })
    expect(page.findAll('[aria-current="page"]').map((one) => one.text())).toEqual(['Model'])
    expect(page.get('.spending-bars h2').text()).toBe('Tokens by model')

    // The overview is the plain address, so choosing it writes no section.
    await entry(page, 'overview').trigger('click')
    expect(written(page).at(-1)).toEqual([{ measure: 'tokens' }, 'replace'])
    // The section on show chosen again writes nothing.
    await entry(page, 'model').trigger('click')
    expect(written(page)).toHaveLength(1)
  })
})

describe('the panel', () => {
  it('shows the figures, the days, what changed and the first values on the overview, and a dimension its whole report', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'overview' } })
    expect(page.get('.analytics-panel').attributes('aria-label')).toBe('Overview')
    expect(page.find('.spending-tiles').exists()).toBe(true)
    expect(page.find('.spending-days').exists()).toBe(true)
    expect(page.find('.overview-changes').exists()).toBe(true)
    expect(page.findAll('.overview-top')).toHaveLength(4)
    expect(page.find('.spending-bars').exists()).toBe(false)
    expect(page.find('.spending-table').exists()).toBe(false)
    // The overview's own read is by task, so moving to the task section asks nothing again.
    expect(reads.grouped('work_item')).toHaveLength(2)
    const asked = reads.asked.length

    await page.setProps({ routeState: { by: 'work_item' } })
    await flushPromises()
    expect(reads.asked).toHaveLength(asked)
    expect(page.get('.analytics-panel').attributes('aria-label')).toBe('Task')
    for (const selector of [
      '.spending-tiles',
      '.spending-bars',
      '.spending-days',
      '.spending-table',
    ])
      expect(page.findAll(selector), selector).toHaveLength(1)
  })
})

describe('a narrow screen', () => {
  it('shows the list alone, and a section chosen there in its place as a new place', async () => {
    narrowWindow()
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'model' } })
    expect(shown(page, '.analytics-rail')).toBe(true)
    expect(shown(page, '.analytics-panel')).toBe(false)

    await entry(page, 'role').trigger('click')
    expect(written(page).at(-1)).toEqual([{ by: 'role', open: 'section' }, 'push'])
    await page.setProps({ routeState: written(page).at(-1)?.[0] })
    await flushPromises()
    expect(shown(page, '.analytics-rail')).toBe(false)
    expect(shown(page, '.analytics-panel')).toBe(true)
    expect(page.get('.analytics-panel-name').text()).toBe('Role')
    // Focus goes with the reader, to the way back at the head of the section.
    expect(document.activeElement).toBe(page.get('.analytics-panel-back').element)

    // Back, as the browser's: the address before, and the list with its section.
    await page.setProps({ routeState: { by: 'model' } })
    await flushPromises()
    expect(shown(page, '.analytics-rail')).toBe(true)
    expect(shown(page, '.analytics-panel')).toBe(false)
    expect(document.activeElement).toBe(entry(page, 'model').element)
  })

  it('leads back to the list from the head of a section as a new place', async () => {
    narrowWindow()
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'overview', open: 'section' } })
    expect(page.get('.analytics-panel-back').text()).toBe('All sections')
    await page.get('.analytics-panel-back').trigger('click')
    expect(written(page).at(-1)).toEqual([{}, 'push'])
  })

  it('keeps a section open while a press narrows it', async () => {
    narrowWindow()
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const page = await mountAnalytics({ routeState: { by: 'model', open: 'section' } })
    const bar = page.findAll('.spending-bars button').find((one) => one.text().includes('model-a'))
    if (!bar) throw new Error('no bar of model-a')
    await bar.trigger('click')
    const [state, mode] = written(page).at(-1) ?? []
    expect(mode).toBe('push')
    expect(state).toEqual({ by: 'work_item', open: 'section', filters: '{"model":["model-a"]}' })
  })
})

describe('the bar', () => {
  it('names each filter as a chip with its dimension, and a chip takes its value out', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const filters = JSON.stringify({ model: ['model-a', 'model-b'], work_item: [null] })
    const page = await mountAnalytics({ routeState: { filters } })
    const chips = page.findAll('.analytics-bar-filters .combo-chip')
    expect(chips.map((chip) => chip.text())).toEqual([
      'Task: No task',
      'Model: model-a',
      'Model: model-b',
    ])
    await chips[1]?.get('button').trigger('click')
    expect(written(page).at(-1)).toEqual([
      { filters: JSON.stringify({ work_item: [null], model: ['model-b'] }) },
      'replace',
    ])
    expect(chips[1]?.get('button').attributes('aria-label')).toBe('Remove Model: model-a')
  })

  it('opens a field of every value per dimension from «add a filter»', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
    // A section whose reads are by task alone, so a read by model is the filter's.
    const page = await mountAnalytics({ routeState: { by: 'work_item' } })
    const add = page.get('.analytics-filter-add')
    const fields = page.get(`#${add.attributes('aria-controls') ?? 'none'}`)
    expect(add.attributes('aria-expanded')).toBe('false')
    expect((fields.element as HTMLElement).style.display).toBe('none')
    await add.trigger('click')
    await flushPromises()
    expect(add.attributes('aria-expanded')).toBe('true')
    expect((fields.element as HTMLElement).style.display).toBe('')
    expect(fields.findAll('[data-dimension]')).toHaveLength(USAGE_DIMENSIONS.length)
    expect(reads.grouped('model')).toHaveLength(1)
  })

  it('says how old the newest record is, and reads the figures again', async () => {
    const reads = stubAnalyticsReads((query) => {
      const answer = serveUsage(WORLD, query)
      answer.usage.last_event_at = momentAt(new Date(2026, 10, 11, 12, 5))
      return answer
    })
    const page = await mountAnalytics()
    const fresh = page.get('.analytics-bar-fresh time')
    expect(fresh.text()).toBe('Newest record 2\u{A0}h\u{A0}25\u{A0}min ago')
    expect(fresh.attributes('datetime')).toBe(momentAt(new Date(2026, 10, 11, 12, 5)))
    const asked = reads.asked.length
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    expect(reads.asked.length).toBeGreaterThan(asked)
  })

  it('says so when nothing was ever recorded, in Russian', async () => {
    stubAnalyticsReads((query) => {
      const answer = serveUsage(WORLD, query)
      answer.usage.last_event_at = null
      return answer
    })
    const page = await mountAnalytics({}, 'ru')
    expect(page.get('.analytics-bar-fresh').text()).toBe('Записей ещё нет')
    expect(page.get('.analytics-refresh').text()).toBe('Обновить')
    expect(page.get('.analytics-filter-add').text()).toBe('Добавить фильтр')
    expect(entries(page)[0]?.text()).toBe('Обзор')
  })
})
