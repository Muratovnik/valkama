/**
 * What the executor section's «ⓘ» says of its own name, held to DESIGN.md § Analytics: an executor
 * is the session of an agent that did the work, which planning calls by the same word, so the
 * section keeps «Executor» and says first in its «ⓘ» what it means, in both languages, before the
 * spending caveats every dimension's «ⓘ» says. Another dimension's «ⓘ» says no such line.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

vi.mock('@/shared/api/analyticsUses.ts', () => ({ reportAnalyticsUse: vi.fn() }))

const NOW = new Date(2026, 10, 11, 14, 30)

/** An hour of one task by one made-up session of an agent. */
const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(1, 'One'), executor: value('claude · 01234567') },
    spend: { seconds: 3600 },
  },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  stubAnalyticsReads(
    (query) => serveUsage(WORLD, query),
    () => quotaAnswer(quotaAt(NOW)),
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const words = (text: string) => text.replaceAll(/\s+/gu, ' ').trim()

/** What the «ⓘ» of the section on show says, a line each, once pressed. */
async function aboutOf(page: VueWrapper) {
  const presses = page.findAll('.analytics-panel .level-about-press')
  expect(presses).toHaveLength(1)
  await presses[0]?.trigger('click')
  await flushPromises()
  const tips = document.querySelectorAll('[role="tooltip"]')
  expect(tips).toHaveLength(1)
  return [...(tips[0]?.querySelectorAll('p') ?? [])].map((line) => words(line.textContent ?? ''))
}

describe('the executor section’s «ⓘ»', () => {
  for (const [locale, heading, said, time] of [
    [
      'en',
      'Executor',
      'An executor is the agent session that did the work.',
      'Agent time adds up agents working at once',
    ],
    [
      'ru',
      'Исполнитель',
      'Исполнитель — сессия агента, которая делала работу.',
      'Время агентов, работающих одновременно',
    ],
  ] as const)
    it(`says first what an executor is, then the spending caveats, in ${locale}`, async () => {
      const page = await mountAnalytics({ routeState: { by: 'executor' } }, locale)
      // The section keeps its name.
      expect(words(page.get('.analytics-panel .level-heading').text())).toBe(heading)
      const about = await aboutOf(page)
      expect(about[0]).toBe(said)
      expect(about.slice(1).some((line) => line.startsWith(time))).toBe(true)
    })

  it('is said of the executor alone: the task section’s «ⓘ» has no such line', async () => {
    const page = await mountAnalytics({ routeState: { by: 'work_item' } })
    const about = await aboutOf(page)
    expect(about.some((line) => line.startsWith('Agent time adds up'))).toBe(true)
    expect(about.join(' ')).not.toContain('executor')
  })
})
