/**
 * Which projects the Analytics page's figures are of, as the page's scope says. The oracle is the
 * requirement: beside the heading of every section the period's figures fill, a few quiet words
 * name them, «project Billing» or «all projects», and the quota's sections, which are of no
 * project, have none; the overview's «ⓘ» says the same as a sentence, of the one project the page
 * is scoped to, by the shell's name for it (its id where it has none), or of all projects on the
 * global page; and the quota's «ⓘ» says that the quota is the whole account's, whatever project
 * is chosen.
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
  it('says all projects in the overview’s «ⓘ» on the global page', async () => {
    const page = await mountAnalytics({ routeState: {} })
    expect(await aboutOf(page)).toContain('The figures are of all projects.')
  })

  it('names the project the page is scoped to in the overview’s «ⓘ»', async () => {
    const page = await mountAnalytics({
      routeState: {},
      projectId: 'billing-service',
      projectTitle: 'Billing',
    })
    const about = await aboutOf(page)
    expect(about).toContain('The figures are of the project Billing alone.')
    expect(about).not.toContain('The figures are of all projects.')
  })

  it('names the project by its id where the shell has no name for it, in Russian', async () => {
    const page = await mountAnalytics({ routeState: {}, projectId: 'billing-service' }, 'ru')
    expect(await aboutOf(page)).toContain('Цифры — только по проекту billing-service.')
    page.unmount()
    const global = await mountAnalytics({ routeState: {} }, 'ru')
    expect(await aboutOf(global)).toContain('Цифры — по всем проектам.')
  })
})

/** The words beside the heading of the section on show, or null where it has none. */
const besideOf = (page: VueWrapper) => {
  const head = page.get('.analytics-panel .level-section > .level-head')
  const scope = head.find('[data-part="scope"]')
  return scope.exists() ? words(scope.text()) : null
}

/** Every section the period's figures fill: the overview, a dimension's and the tokens'. */
const SPENDING = [{}, { by: 'model' }, { by: 'token_kind' }]

describe('the projects beside a section’s heading', () => {
  it.each(SPENDING)('names the project the page is scoped to beside %o', async (routeState) => {
    const page = await mountAnalytics({
      routeState,
      projectId: 'billing-service',
      projectTitle: 'Billing',
    })
    expect(besideOf(page)).toBe('project Billing')
  })

  it.each(SPENDING)(
    'says all projects beside %o on the global page, in Russian',
    async (routeState) => {
      const page = await mountAnalytics({ routeState }, 'ru')
      expect(besideOf(page)).toBe('все проекты')
    },
  )

  it('names the project by its id where the shell has no name for it', async () => {
    const page = await mountAnalytics({ routeState: { by: 'model' }, projectId: 'billing-service' })
    expect(besideOf(page)).toBe('project billing-service')
  })

  it.each(['quota_five_hour', 'quota_week'])('says none beside the quota’s %s', async (by) => {
    const page = await mountAnalytics({
      routeState: { by },
      projectId: 'billing-service',
      projectTitle: 'Billing',
    })
    expect(besideOf(page)).toBeNull()
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
