/**
 * The pauses section of the Analytics page, against stand-ins for its usage and pauses reads. The
 * oracle is the requirement of the view: «Pauses» stands on the rail after the quota and
 * before the dimensions; its read goes back to the transcripts, so it is asked only while its
 * section is on show — when it opens, when the period changes and on the bar's refresh, never for
 * the measure; its entry says what it shows, as the others show figures. Its heading is its name
 * on the rail and stands, with the choice of wait, from the first moment of the read. Its panel
 * shows, for the wait chosen (the machine first), a table per environment with a line for each
 * bucket its requests fell in, and none for another, and a line of their sum whose shares are of
 * the sum's tokens. In a project's scope it reads that project's runs and says so beside its
 * heading; on the global page every run. An environment's heading breaks between its words, so
 * its model id never ends a line at its hyphen. Every table has the same seven columns;
 * the cold requests sent during background work are «—» where the client does not tell it. A
 * wait with no request, an answer with none, a first read that failed and a read again that
 * failed each say so in words of their own.
 *
 * The figures come from `PAUSES`: the Claude subagent's machine waits read 990 of 1,000 and 10 of
 * 1,000, so its sum reads 50%, and wrote the rest, 50%.
 */
import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { PAUSES, pausesAnswer, pausesOf } from '../fixtures/pauses.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

const NOW = new Date(2026, 10, 11, 14, 30)

const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(1, 'One'), model: value('model-a') },
    spend: { seconds: 3600, tokens: 1000, cost: 1 },
  },
]
const usage = (query: URLSearchParams) => serveUsage(WORLD, query)

const environments = (page: VueWrapper) =>
  page.findAll('[data-environment]').map((block) => block.find('.level-heading').text())
const block = (page: VueWrapper, client: string) =>
  page
    .findAll('[data-environment]')
    .find((one) => JSON.parse(one.attributes('data-environment') ?? '[]')[0] === client)
const line = (page: VueWrapper, client: string, bucket: string) =>
  (block(page, client)?.find(`[data-bucket="${bucket}"]`).findAll('td') ?? []).map((cell) =>
    cell.text(),
  )
const heads = (page: VueWrapper, client: string) =>
  (block(page, client)?.findAll('thead th') ?? []).map((cell) => cell.text())

async function chooseWait(page: VueWrapper, label: string) {
  const option = page.findAll('.segmented-option').find((one) => one.text() === label)
  await option?.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('the pauses section', () => {
  it('stands on the rail after the quota, and is read only while it is on show', async () => {
    const reads = stubAnalyticsReads(usage, undefined, () => pausesAnswer(PAUSES))
    const page = await mountAnalytics()
    const rail = page.findAll('[data-section]').map((one) => one.attributes('data-section'))
    expect(rail.slice(rail.indexOf('quota_week'), rail.indexOf('quota_week') + 2)).toEqual([
      'quota_week',
      'pauses',
    ])
    expect(reads.pausesAsked).toHaveLength(0)
    expect(page.get('[data-section="pauses"]').text()).toBe('PausesCache after a pause')

    await page.setProps({ routeState: { by: 'pauses' } })
    await flushPromises()
    expect(reads.pausesAsked).toHaveLength(1)
    expect([...reads.pausesAsked[0].keys()].sort()).toEqual(['from', 'to', 'utc_offset'])

    await page.setProps({ routeState: { by: 'pauses', measure: 'cost' } })
    await flushPromises()
    expect(reads.pausesAsked).toHaveLength(1)
    await page.setProps({ routeState: { by: 'pauses', period: 'weeks4' } })
    await flushPromises()
    expect(reads.pausesAsked).toHaveLength(2)
    expect(reads.pausesAsked[1].get('from')).not.toBe(reads.pausesAsked[0].get('from'))

    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    expect(reads.pausesAsked).toHaveLength(3)
    await page.setProps({ routeState: {} })
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    expect(reads.pausesAsked).toHaveLength(3)
  })

  it('counts the runs of the page’s project in a project scope, and every run on the global page', async () => {
    const reads = stubAnalyticsReads(usage, undefined, (query) =>
      pausesAnswer({ ...PAUSES, project: query.get('project') }),
    )
    const page = await mountAnalytics({
      routeState: { by: 'pauses' },
      projectId: 'rover',
      projectTitle: 'Rover',
    })
    expect(reads.pausesAsked.map((query) => query.get('project'))).toEqual(['rover'])
    expect(page.get('.pauses-panel [data-part="scope"]').text()).toBe('project Rover')
    expect(environments(page)).toHaveLength(2)

    await page.setProps({ projectId: null, projectTitle: null })
    await flushPromises()
    expect(reads.pausesAsked.map((query) => query.has('project'))).toEqual([true, false])
    expect(page.get('.pauses-panel [data-part="scope"]').text()).toBe('all projects')
  })

  it('shows its heading and choice of wait while the first read waits', async () => {
    const reads = stubAnalyticsReads(usage, undefined, () => 'hold')
    const page = await mountAnalytics({ routeState: { by: 'pauses' } })
    expect(page.get('.pauses-panel .level-heading').text()).toBe('Pauses')
    expect(page.findAll('.pauses-panel .segmented-option').map((one) => one.text())).toEqual([
      'Machine',
      'Person',
      'Wakes',
    ])
    expect(page.find('.pauses-panel .work-dots').exists()).toBe(true)
    // The line the server's progress will take stands from the first moment, so it moves nothing.
    expect(page.get('.pauses-panel [data-part="wait-detail"]').text()).toBe('')
    reads.held[0]?.release(pausesAnswer(PAUSES))
    await flushPromises()
    expect(environments(page)).toHaveLength(2)
  })

  it('says how many runs a first read has parsed, in its one loading panel, while the server is still reading', async () => {
    let asks = 0
    const reads = stubAnalyticsReads(usage, undefined, () => {
      asks += 1
      if (asks === 1)
        return {
          status: 202,
          body: {
            interface_version: 'valkama-analytics-api',
            reading: { runs_read: 640, runs_left: 1199 },
          },
        }
      return 'hold'
    })
    const page = await mountAnalytics({ routeState: { by: 'pauses' } })
    await vi.waitFor(() => expect(reads.held).toHaveLength(1))
    const panel = page.get('.pauses-panel .platform-state-panel')
    expect(panel.get('[data-part="wait-detail"]').text()).toBe('Runs read: 640 of 1,839.')
    expect(page.findAll('.pauses-panel .work-dots')).toHaveLength(1)
    expect(page.find('.pauses-panel [data-note]').exists()).toBe(false)
    reads.held[0]?.release(pausesAnswer(PAUSES))
    await flushPromises()
    expect(page.find('[data-part="wait-detail"]').exists()).toBe(false)
    expect(environments(page)).toHaveLength(2)
  })

  it('shows a table per environment with the buckets of the wait and their sum, for the machine first', async () => {
    stubAnalyticsReads(usage, undefined, () => pausesAnswer(PAUSES))
    const page = await mountAnalytics({ routeState: { by: 'pauses' } })
    expect(environments(page)).toEqual([
      'Claude Code · subagent · claude-sonnet-4-5 · subscription',
      'Codex · main session · gpt-5-codex · sign-in not known',
    ])
    // Each word of a heading is a box of its own, so a model id goes to the next line whole.
    const words = block(page, 'claude')?.findAll('.level-heading .whole-word') ?? []
    expect(words.map((one) => one.text())).toContain('claude-sonnet-4-5')
    const claude = block(page, 'claude')
    expect(claude?.findAll('tbody tr').map((one) => one.attributes('data-bucket'))).toEqual([
      '0-4m',
      '5-6m',
      'total',
    ])
    const columns = ['Pause', 'Requests', 'Read', 'Written', 'Cold', 'Cold in background', 'Cost']
    expect(heads(page, 'claude')).toEqual(columns)
    expect(heads(page, 'codex')).toEqual(columns)
    expect(
      block(page, 'codex')
        ?.findAll('tbody tr')
        .map((one) => one.attributes('data-bucket')),
    ).toEqual(['0-4m', 'total'])
    const [requests, read, written, cold, background, cost] = line(page, 'claude', 'total')
    expect([requests, read, written, cold, background]).toEqual(['14', '50%', '50%', '4', '1'])
    expect(cost).toContain('1.75')
    expect(line(page, 'codex', 'total').slice(0, 5)).toEqual(['3', '75%', '0%', '0', '—'])
  })

  it('switches to a person’s waits, and says so when no wake ran', async () => {
    stubAnalyticsReads(usage, undefined, () => pausesAnswer(PAUSES))
    const page = await mountAnalytics({ routeState: { by: 'pauses' } })
    await chooseWait(page, 'Person')
    expect(environments(page)).toEqual([
      'Claude Code · main session · claude-sonnet-4-5 · subscription',
    ])
    expect(line(page, 'claude', '60-70m').slice(0, 2)).toEqual(['1', '10%'])
    expect(
      block(page, 'claude')
        ?.findAll('tbody tr')
        .map((one) => one.attributes('data-bucket')),
    ).toEqual(['60-70m', 'total'])
    await chooseWait(page, 'Wakes')
    expect(environments(page)).toEqual([])
    expect(page.get('[data-note="no-requests"]').text()).toContain(
      'No keep-warm wake ran in this period.',
    )
  })

  it('says when no request followed a pause in the period', async () => {
    stubAnalyticsReads(usage, undefined, () => pausesAnswer(pausesOf([])))
    const page = await mountAnalytics({ routeState: { by: 'pauses' } })
    expect(page.get('.analytics-panel').text()).toContain(
      'No model request followed a pause in this period.',
    )
  })

  it('says a first read failed and reads again on retry', async () => {
    let failing = true
    const reads = stubAnalyticsReads(usage, undefined, () =>
      failing ? { status: 500 } : pausesAnswer(PAUSES),
    )
    const page = await mountAnalytics({ routeState: { by: 'pauses' } })
    expect(page.get('.platform-state-panel').text()).toContain(
      'The pauses before model requests could not be loaded.',
    )
    failing = false
    await page.get('.platform-state-retry').trigger('click')
    await flushPromises()
    expect(reads.pausesAsked).toHaveLength(2)
    expect(environments(page)).toHaveLength(2)
  })

  it('keeps the tables on show when a read again fails, and says so', async () => {
    let failing = false
    stubAnalyticsReads(usage, undefined, () => (failing ? { status: 500 } : pausesAnswer(PAUSES)))
    const page = await mountAnalytics({ routeState: { by: 'pauses' } })
    failing = true
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    expect(environments(page)).toHaveLength(2)
    expect(page.get('[data-note="failed-again"]').text()).toBe(
      'The pauses could not be loaded again, so these are from the read before.',
    )
  })
})
