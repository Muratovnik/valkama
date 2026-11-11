/**
 * The Analytics module's place in the shell: an entry under «Understand», an address that
 * opens its page with its part of the address, and a page that reads its view from there,
 * writes every change back, and waits, fails and stands empty through the shared state panel.
 */
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppModuleStage from '@/app/components/AppModuleStage.vue'
import { useModuleRouteAuthority } from '@/app/composables/useModuleRouteAuthority.ts'

import AppNav from '@/widgets/app-nav/components/AppNav.vue'

import { DEFAULT_VIEW, writeAddress } from '@/shared/api/analyticsAddress.ts'
import { hasModuleRenderer } from '@/shared/api/platformModuleContract.ts'
import type { ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SearchCombobox from '@/shared/ui/SearchCombobox.vue'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
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

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)
const on = (month: number, day: number) => new Date(2026, month, day, 10)
const sample = { project: value('sample'), role: value('main') }

/**
 * The work the stand-in answers from, so that a read asked for the wrong period, filter or scope
 * gets other figures: an hour on the task in the project «sample» this Monday under one account,
 * two hours in another project on Tuesday under another; half an hour on Monday a week before,
 * an hour and a half on that Friday, and an hour three weeks back.
 */
const WORLD: TimedStretch[] = [
  {
    at: on(10, 9),
    group: { ...sample, work_item: ITEM, model: value('model-a'), account: value('acc-a') },
    spend: { seconds: 3600, tokens: 1200, cost: 0.4 },
  },
  {
    at: on(10, 10),
    group: {
      project: value('other'),
      role: value('main'),
      work_item: task(13, 'Elsewhere'),
      model: value('model-b'),
      account: value('acc-b'),
    },
    spend: { seconds: 7200, tokens: 100, cost: 1 },
  },
  { at: on(10, 2), group: { ...sample, work_item: ITEM }, spend: { seconds: 1800 } },
  { at: on(10, 6), group: { ...sample, work_item: ITEM }, spend: { seconds: 5400 } },
  { at: on(9, 20), group: { ...sample, work_item: ITEM }, spend: { seconds: 3600 } },
]

/** The words of the values a filter offers, in its order. */
const offered = (page: VueWrapper, dimension: string) =>
  (
    page
      .findAllComponents(SearchCombobox)
      .find((field) => field.attributes('data-dimension') === dimension)
      ?.props() as { options: ChoiceOption[] } | undefined
  )?.options.map((option) => option.label)

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
    const reads = stubAnalyticsReads((query) => serveUsage(WORLD, query))
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

const serve = () => stubAnalyticsReads((query) => serveUsage(WORLD, query))
const time = (page: VueWrapper) =>
  page.get('.tile-figure[data-measure="time"]').text().replaceAll(/\s/gu, ' ')
const change = (page: VueWrapper) =>
  (page.findAll('.spending-tiles .tile-change')[0]?.text() ?? '').replaceAll(/\s/gu, ' ')

describe('the Analytics page', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("asks for this week by task, in the browser's own time, beside the same days of the week before", async () => {
    const reads = serve()
    const page = await mountAnalytics()
    const [query, ...others] = reads.grouped('work_item')
    expect(query?.get('from')).toBe('2026-11-09')
    expect(query?.get('to')).toBe(NOW.toISOString())
    expect(query?.get('step')).toBe('day')
    expect(query?.get('utc_offset')).toBe(String(-NOW.getTimezoneOffset()))
    // Monday to Wednesday afternoon is held against Monday to Wednesday afternoon a week
    // before, not against the end of that week: the read asks for those days itself.
    expect(query?.get('compare')).toBeNull()
    expect(others.map((before) => [before.get('from'), before.get('to')])).toEqual([
      [new Date(2026, 10, 2).toISOString(), new Date(2026, 10, 4, 14, 30).toISOString()],
    ])
    expect(time(page)).toBe('3 h')
    expect(change(page)).toBe('↑ 500% against Nov 2 – 4')
  })

  it('compares the past four weeks with the four weeks before them, as the read does', async () => {
    const reads = serve()
    await mountAnalytics({ routeState: { period: 'weeks4' } })
    const asked = reads.grouped('work_item')
    expect(asked).toHaveLength(1)
    expect(asked[0]?.get('compare')).toBe('true')
    expect(asked[0]?.get('from')).toBe('2026-10-15')
  })

  it('opens filtered from a link that names a task, and says a filter is set', async () => {
    const reads = serve()
    const link = writeAddress({ ...DEFAULT_VIEW, filters: { work_item: [ITEM.id ?? ''] } })
    const page = await mountAnalytics({ routeState: link })
    expect(reads.grouped('work_item')[0]?.get('work_item')).toBe(ITEM.id)
    expect(page.get('.disclosure-toggle').text()).toBe('Filters · 1')
    // Only the task's own hour: the other project's two hours are not admitted.
    expect(time(page)).toBe('1 h')
    // The chosen task is named, from the values its filter offers.
    const chip = page.get('[data-dimension="work_item"]')
    expect(chip.text()).toContain('MAIN-12 Answer a review in one form')
  })

  it('writes a change of the period into its address and reads it again from there', async () => {
    const reads = serve()
    const page = await mountAnalytics()
    await radio(page, 'Past 4 weeks')?.trigger('click')
    const written = page.emitted<[Record<string, string>]>('state')?.at(-1)?.[0]
    expect(written).toEqual({ period: 'weeks4' })
    await page.setProps({ routeState: written })
    await flushPromises()
    expect(reads.grouped('work_item').at(-1)?.get('from')).toBe('2026-10-15')
    // Four weeks hold the week before and the hour three weeks back as well.
    expect(time(page)).toBe('6 h')
  })

  it("reads a project's figures alone at its scope, and offers no project filter there", async () => {
    const reads = serve()
    const page = await mountAnalytics({ projectId: 'sample' })
    expect(reads.asked.every((query) => query.get('project') === 'sample')).toBe(true)
    expect(time(page)).toBe('1 h')
    expect(page.find('[data-dimension="project"]').exists()).toBe(false)
    expect(page.find('[data-dimension="work_item"]').exists()).toBe(true)
  })

  it("offers each filter's values from the scope's project alone", async () => {
    const reads = serve()
    const page = await mountAnalytics({ projectId: 'sample' })
    await page.get('.disclosure-toggle').trigger('click')
    await flushPromises()
    const offers = reads.grouped('model')
    expect(offers).toHaveLength(1)
    expect(offers[0]?.get('project')).toBe('sample')
    expect(offered(page, 'model')).toEqual(['Unknown', 'model-a'])
  })

  it('draws the account marks read with the answer shown, never the last answer’s', async () => {
    let holding = false
    const reads = stubAnalyticsReads((query) =>
      holding && query.get('group_by') === 'account' ? 'hold' : serveUsage(WORLD, query),
    )
    const page = await mountAnalytics()
    expect(page.findAll('.period-mark')).toHaveLength(1)

    // The new view's answer lands before its accounts: no mark until they do.
    holding = true
    await page.setProps({ routeState: { by: 'model' } })
    await flushPromises()
    expect(page.get('.spending-days h2').text()).toContain('by model')
    expect(page.findAll('.period-mark')).toHaveLength(0)
    const [accounts] = reads.held
    accounts?.release(serveUsage(WORLD, accounts.query))
    await flushPromises()
    expect(page.findAll('.period-mark')).toHaveLength(1)
    expect(page.find('.spending-days-note').exists()).toBe(false)

    // An account read that fails says the marks are not there.
    await page.setProps({ routeState: { by: 'role' } })
    await flushPromises()
    reads.held[1]?.release({ status: 500 })
    await flushPromises()
    expect(page.findAll('.period-mark')).toHaveLength(0)
    expect(page.get('.spending-days-note').text()).toBe(
      'The accounts that worked could not be read, so their changes are not marked.',
    )
  })

  it('asks only what a view change changes, with the filters open', async () => {
    const reads = serve()
    const page = await mountAnalytics({ routeState: { period: 'weeks4' } })
    const asks = async (routeState?: Record<string, string>) => {
      const before = reads.asked.length
      if (routeState) await page.setProps({ routeState })
      else await page.get('.disclosure-toggle').trigger('click')
      await flushPromises()
      return reads.asked.length - before
    }
    const counts = {
      opened: reads.asked.length,
      filtersOpened: await asks(),
      by: await asks({ period: 'weeks4', by: 'model' }),
      measure: await asks({ period: 'weeks4', by: 'model', measure: 'cost' }),
      filter: await asks({
        period: 'weeks4',
        by: 'model',
        measure: 'cost',
        filters: JSON.stringify({ model: ['model-a'] }),
      }),
      week: await asks({ by: 'model', measure: 'cost' }),
    }
    // A view: its answer and its accounts, and for this week the same days of the week before;
    // the values offered only when the period changes; nothing for the measure alone.
    expect(counts).toEqual({
      opened: 2,
      filtersOpened: 9,
      by: 2,
      measure: 0,
      filter: 2,
      week: 3 + 9,
    })
  })

  it('waits for the read through the shared state panel', async () => {
    stubAnalyticsReads(() => 'hold')
    const page = await mountAnalytics()
    expect(page.find('[aria-busy="true"]').exists()).toBe(true)
  })

  it('keeps the last answer on screen while the next view is read', async () => {
    let holding = false
    stubAnalyticsReads((query) => (holding ? 'hold' : serveUsage(WORLD, query)))
    const page = await mountAnalytics()
    expect(time(page)).toBe('3 h')
    holding = true
    await page.setProps({ routeState: { period: 'weeks4' } })
    await flushPromises()
    expect(time(page)).toBe('3 h')
  })

  it('says a failed read failed, and asks again on retry', async () => {
    const reads = stubAnalyticsReads(() => ({ status: 500 }))
    const page = await mountAnalytics()
    expect(page.get('[role="alert"]').text()).toContain('could not be read')
    const asked = reads.grouped('work_item').length
    await page.get('.platform-state-retry').trigger('click')
    await flushPromises()
    expect(reads.grouped('work_item')).toHaveLength(asked * 2)
  })

  it('says a period that spent nothing spent nothing, and keeps its controls', async () => {
    serve()
    const page = await mountAnalytics({ projectId: 'empty' })
    expect(page.get('[role="status"]').text()).toContain('Nothing was spent in this period')
    expect(radio(page, 'This week')).toBeDefined()
  })

  it('says the same in Russian', async () => {
    serve()
    const page = await mountAnalytics({ projectId: 'empty' }, 'ru')
    expect(page.text()).toContain('За этот период ничего не потрачено')
  })
})
