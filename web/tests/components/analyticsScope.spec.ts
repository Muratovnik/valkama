/**
 * Which projects the Analytics page's figures are of, as the page's scope says. The oracle is the
 * requirement: beside the period the bar says «project <name>» on a page scoped to one project
 * and «all projects» on the global page, in the words of the shell's name for the project (its id
 * where it has none); the overview's «ⓘ» says the same as a sentence; and the quota's «ⓘ» says that
 * the quota is the whole account's, whatever project is chosen.
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

/** An hour of one task in the one project there is, which its scope admits. */
const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(1, 'One'), project: value('billing-service') },
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

/** What the bar says of the projects, by the part it documents. */
const barScope = (page: VueWrapper) => words(page.get('.analytics-bar-scope').text())

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

describe('which projects the figures are of', () => {
  it('says all projects in the bar and in the overview’s «ⓘ» on the global page', async () => {
    const page = await mountAnalytics({ routeState: {} })
    expect(barScope(page)).toBe('all projects')
    expect(await aboutOf(page)).toContain('The figures are of all projects.')
  })

  it('names the project the page is scoped to, in the bar and in the overview’s «ⓘ»', async () => {
    const page = await mountAnalytics({
      routeState: {},
      projectId: 'billing-service',
      projectTitle: 'Billing',
    })
    expect(barScope(page)).toBe('project Billing')
    const about = await aboutOf(page)
    expect(about).toContain('The figures are of the project Billing alone.')
    expect(about).not.toContain('The figures are of all projects.')
  })

  it('names the project by its id where the shell has no name for it, in Russian', async () => {
    const page = await mountAnalytics({ routeState: {}, projectId: 'billing-service' }, 'ru')
    expect(barScope(page)).toBe('проект billing-service')
    expect(await aboutOf(page)).toContain('Цифры — только по проекту billing-service.')
    page.unmount()
    const global = await mountAnalytics({ routeState: {} }, 'ru')
    expect(barScope(global)).toBe('все проекты')
  })

  it('keeps the projects in the bar on every section', async () => {
    const page = await mountAnalytics({
      routeState: { by: 'model' },
      projectId: 'billing-service',
      projectTitle: 'Billing',
    })
    expect(barScope(page)).toBe('project Billing')
  })
})

describe('the quota and the project', () => {
  for (const [locale, said] of [
    ['en', "The quota is the whole account's: the chosen project does not change it."],
    ['ru', 'Квота — на весь аккаунт: выбранный проект её не меняет.'],
  ] as const)
    it(`says in the quota’s «ⓘ» that it is the whole account’s, in ${locale}`, async () => {
      const page = await mountAnalytics(
        { routeState: { by: 'quota_week' }, projectId: 'billing-service', projectTitle: 'Billing' },
        locale,
      )
      expect(await aboutOf(page)).toContain(said)
    })
})
