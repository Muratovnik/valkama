/**
 * The page offers its breakdown as a file. The oracle is the requirement: a press on the button
 * by the table hands the browser one file named by the period, whose bytes are UTF-8 behind a
 * byte order mark and say what the table shows; with nothing to list, the button is disabled and
 * the words beside it say why.
 */
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { momentAt, serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)
const MONDAY = new Date(2026, 10, 9)
const MONDAY_BEFORE = new Date(2026, 10, 2)

const ITEM = task(12, 'Answer, "quoted"')

/**
 * An hour this Monday with tokens and a price; half an hour the Monday before, with neither; all
 * of it in the project «sample».
 */
const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 9, 10),
    group: { work_item: ITEM, project: value('sample') },
    spend: { seconds: 3600, tokens: 1200, cost: 0.4 },
  },
  {
    at: new Date(2026, 10, 2, 10),
    group: { work_item: ITEM, project: value('sample') },
    spend: { seconds: 1800 },
  },
]

/** The read's offset at a moment: the browser's own, east of UTC. */
const offsetAt = (moment: Date) => -moment.getTimezoneOffset()

/** What the browser was handed: each file, by its name and its contents. */
function catchDownloads() {
  const files: Blob[] = []
  const names: string[] = []
  const created = vi.fn((file: Blob) => {
    files.push(file)
    return `blob:file-${files.length}`
  })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: created })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download)
  })
  return { files, names }
}

const button = (page: VueWrapper) => page.get('.spending-download')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the breakdown as a file', () => {
  it('downloads what the table shows, named by its period, with a byte order mark', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const { files, names } = catchDownloads()
    const page = await mountAnalytics()
    expect(button(page).text()).toBe('Download CSV')
    await button(page).trigger('click')

    expect(names).toEqual(['agent-usage-2026-11-09-to-2026-11-11-by-work_item.csv'])
    expect(files).toHaveLength(1)
    const [file] = files
    expect(file?.type).toBe('text/csv;charset=utf-8')
    const bytes = new Uint8Array((await file?.arrayBuffer()) ?? new ArrayBuffer(0))
    expect(Array.from(bytes.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const bounds = [
      momentAt(MONDAY, offsetAt(NOW)),
      momentAt(NOW, offsetAt(NOW)),
      momentAt(MONDAY_BEFORE, offsetAt(MONDAY_BEFORE)),
      momentAt(new Date(2026, 10, 4, 14, 30), offsetAt(MONDAY_BEFORE)),
    ].join(',')
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)).toBe(
      '\u{FEFF}' +
        'breakdown,value_id,value_reference,value_name,value_kind,time_seconds,tokens,cost_usd,unpriced_tokens,before_time_seconds,before_tokens,before_cost_usd,before_unpriced_tokens,period_from,period_to,before_from,before_to,filters\r\n' +
        `work_item,${ITEM.id},MAIN-12,"Answer, ""quoted""",category,3600,1200,0.4,0,1800,,,0,${bounds},\r\n`,
    )
  })

  it('names the filters the view was read with, its project among them', async () => {
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
    const { files } = catchDownloads()
    const page = await mountAnalytics({
      projectId: 'sample',
      routeState: { filters: JSON.stringify({ work_item: [ITEM.id] }) },
    })
    await button(page).trigger('click')
    const text = (await files[0]?.text()) ?? ''
    expect(
      text
        .split('\r\n')[1]
        ?.endsWith(`,"{""project"":[""sample""],""work_item"":[""${ITEM.id}""]}"`),
    ).toBe(true)
  })

  it('is disabled, with words, while there is nothing to download', async () => {
    // Nothing this week, and the week before could not be read: the report stands with no value.
    stubAnalyticsReads((query) =>
      query.get('from')?.includes('T') ? { status: 500 } : serveUsage([], query),
    )
    const { names } = catchDownloads()
    const page = await mountAnalytics()
    const download = button(page)
    expect(download.attributes('disabled')).toBeDefined()
    const note = page.get(`#${download.attributes('aria-describedby') ?? 'none'}`)
    expect(note.text()).toBe('Nothing to download: this view holds no value.')
    await download.trigger('click')
    expect(names).toEqual([])
  })
})
