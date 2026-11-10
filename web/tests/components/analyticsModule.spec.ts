/**
 * The Analytics module's place in the shell: an entry under «Understand», an address that
 * opens its page with its part of the address, and a page that reads its view from there,
 * writes every change back, and waits, fails and stands empty through the shared state panel.
 */
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import AppModuleStage from '@/app/components/AppModuleStage.vue'
import { useModuleRouteAuthority } from '@/app/composables/useModuleRouteAuthority.ts'

import { DEFAULT_VIEW, writeAddress } from '@/pages/analytics/utils/analyticsAddress.ts'

import AppNav from '@/widgets/app-nav/components/AppNav.vue'

import { hasModuleRenderer } from '@/shared/api/platformModuleContract.ts'
import type { ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { task, usageAnswer } from '../fixtures/analytics.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

function i18n(locale: 'en' | 'ru' = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages, pluralRules })
}

/** What the rail is handed: the declared modules this build can draw, as the live feed picks them. */
const drawable: readonly ModuleManifest[] = OFFLINE_MODULE_FALLBACK.filter((module) =>
  hasModuleRenderer(module.module_id),
)

const PROJECT = { kind: 'project' as const, project_ref: { project_id: 'sample' } }

const ITEM = task(12, 'Answer a review in one form')
const DAY = 86_400_000

/** A week that spent something on one task, from this Monday to now. */
function aWeek() {
  const now = new Date()
  const back = (now.getDay() + 6) % 7
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
  return usageAnswer({
    first: monday,
    days: back + 1,
    end: now,
    groupBy: ['work_item'],
    stretches: [
      { day: 0, group: { work_item: ITEM }, spend: { seconds: 3600, tokens: 1200, cost: 0.4 } },
    ],
  })
}

const nothingSpent = () =>
  usageAnswer({ first: new Date(2026, 10, 9), days: 1, groupBy: ['work_item'], stretches: [] })

const radio = (wrapper: Pick<VueWrapper, 'findAll'>, name: string) =>
  wrapper.findAll('[role="radio"]').find((one) => one.text() === name)

describe('the Analytics entry on the rail', () => {
  it('stands under Understand and goes to its module', async () => {
    const nav = mount(AppNav, {
      props: { active: null, modules: drawable },
      global: { plugins: [i18n()] },
    })
    const group = nav
      .findAll('.nav-group')
      .find((section) => section.find('.nav-group-heading').text() === 'Understand')
    if (group === undefined) throw new Error('the rail has no Understand group')
    const entry = group.get('.nav-item.module-analytics')
    expect(entry.text()).toBe('Analytics')
    await entry.trigger('click')
    expect(nav.emitted('navigate')).toEqual([['analytics']])
  })
})

describe('the Analytics address', () => {
  it.each([{ kind: 'global' as const }, PROJECT])(
    'is owned by its module at the %o scope',
    (scope) => {
      const route = ref<PlatformRoute>({ module_id: 'analytics', scope })
      const authority = useModuleRouteAuthority({
        modules: ref(drawable),
        modulesAuthoritative: ref(true),
        modulesSettled: ref(true),
        parsedUnavailable: ref(null),
        registrations: ref(
          drawable.map((manifest) => ({
            manifest,
            state: 'enabled' as const,
            mutable: false as const,
            revision: 1,
            updated_at: '2026-11-10T00:00:00Z',
          })),
        ),
        route,
        te: () => true,
        translate: (key) => key,
      })
      expect(authority.activeManifest.value?.module_id).toBe('analytics')
      expect(authority.routeUnavailable.value).toBeNull()
    },
  )

  it('opens the Analytics page on the stage, with its part of the address', async () => {
    const reads = stubAnalyticsReads(aWeek)
    const stage = mount(AppModuleStage, {
      props: {
        activeModule: 'analytics',
        context: null,
        locale: 'en',
        moduleTitle: 'Analytics',
        primaryWriteScopeId: null,
        questionAsked: false,
        route: {
          module_id: 'analytics',
          scope: PROJECT,
          state: { by: 'model', filters: JSON.stringify({ work_item: [ITEM.id] }) },
        },
        scope: PROJECT,
        stateBytes: 2048,
      },
      global: { plugins: [i18n()] },
    })
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(stage.get('.module-frame').attributes('aria-label')).toBe('Analytics')
    expect(stage.find('.analytics-page').exists()).toBe(true)
    expect(stage.find('.work-item-board').exists()).toBe(false)
    const query = reads.grouped('model')[0]
    expect(query?.get('work_item')).toBe(ITEM.id)
    expect(query?.get('project')).toBe('sample')
    await radio(stage, 'Past 4 weeks')?.trigger('click')
    expect(stage.emitted('state')?.at(-1)?.[0]).toEqual({
      period: 'weeks4',
      by: 'model',
      filters: JSON.stringify({ work_item: [ITEM.id] }),
    })
  })
})

describe('the Analytics page', () => {
  it("asks for this week by task, in the browser's own time, beside the week before", async () => {
    const reads = stubAnalyticsReads(aWeek)
    await mountAnalytics()
    const [query] = reads.asked
    expect(query?.get('group_by')).toBe('work_item')
    expect(query?.get('compare')).toBe('true')
    expect(query?.get('step')).toBe('day')
    expect(query?.get('utc_offset')).toBe(String(-new Date().getTimezoneOffset()))
  })

  it('opens filtered from a link that names a task, and says a filter is set', async () => {
    const reads = stubAnalyticsReads(aWeek)
    const link = writeAddress({ ...DEFAULT_VIEW, filters: { work_item: [ITEM.id] } })
    const page = await mountAnalytics({ routeState: link })
    expect(reads.grouped('work_item')[0]?.get('work_item')).toBe(ITEM.id)
    expect(page.get('.disclosure-toggle').text()).toBe('Filters · 1')
    // The chosen task is named, from the values its filter offers.
    const chip = page.get('[data-dimension="work_item"]')
    expect(chip.text()).toContain('MAIN-12 Answer a review in one form')
  })

  it('writes a change of the period into its address and reads it again from there', async () => {
    const reads = stubAnalyticsReads(aWeek)
    const page = await mountAnalytics()
    await radio(page, 'Past 4 weeks')?.trigger('click')
    const written = page.emitted<[Record<string, string>]>('state')?.at(-1)?.[0]
    expect(written).toEqual({ period: 'weeks4' })
    await page.setProps({ routeState: written })
    await flushPromises()
    const from = reads.grouped('work_item').at(-1)?.get('from') ?? ''
    const back = Date.now() - new Date(`${from}T00:00`).getTime()
    expect(back).toBeGreaterThan(27 * DAY)
    expect(back).toBeLessThan(28 * DAY)
  })

  it("reads a project's figures alone at its scope, and offers no project filter there", async () => {
    const reads = stubAnalyticsReads(aWeek)
    const page = await mountAnalytics({ projectId: 'sample' })
    expect(reads.asked[0]?.get('project')).toBe('sample')
    expect(page.find('[data-dimension="project"]').exists()).toBe(false)
    expect(page.find('[data-dimension="work_item"]').exists()).toBe(true)
  })

  it('waits for the read through the shared state panel', async () => {
    stubAnalyticsReads(() => 'hold')
    const page = await mountAnalytics()
    expect(page.find('[aria-busy="true"]').exists()).toBe(true)
  })

  it('says a failed read failed, and asks again on retry', async () => {
    const reads = stubAnalyticsReads(() => ({ status: 500 }))
    const page = await mountAnalytics()
    expect(page.get('[role="alert"]').text()).toContain('could not be read')
    await page.get('.platform-state-retry').trigger('click')
    await flushPromises()
    expect(reads.grouped('work_item')).toHaveLength(2)
  })

  it('says a period that spent nothing spent nothing, and keeps its controls', async () => {
    stubAnalyticsReads(nothingSpent)
    const page = await mountAnalytics()
    expect(page.get('[role="status"]').text()).toContain('Nothing was spent in this period')
    expect(radio(page, 'This week')).toBeDefined()
  })

  it('says the same in Russian', async () => {
    stubAnalyticsReads(nothingSpent)
    const page = await mountAnalytics({}, 'ru')
    expect(page.text()).toContain('За этот период ничего не потрачено')
  })
})
