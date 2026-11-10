/**
 * The Analytics module's place in the shell: an entry under «Understand», an address that
 * opens its page, and a page that says honestly that nothing has been collected yet.
 */
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppModuleStage from '@/app/components/AppModuleStage.vue'
import { useModuleRouteAuthority } from '@/app/composables/useModuleRouteAuthority.ts'

import AnalyticsView from '@/pages/analytics/AnalyticsView.vue'

import AppNav from '@/widgets/app-nav/components/AppNav.vue'

import { hasModuleRenderer } from '@/shared/api/platformModuleContract.ts'
import type { ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { uiError, uiLoading } from '@/shared/api/platformUiState.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'

function i18n(locale: 'en' | 'ru' = 'en') {
  return createI18n({ legacy: false, locale, fallbackLocale: 'en', messages, pluralRules })
}

/** What the rail is handed: the declared modules this build can draw, as the live feed picks them. */
const drawable: readonly ModuleManifest[] = OFFLINE_MODULE_FALLBACK.filter((module) =>
  hasModuleRenderer(module.module_id),
)

const PROJECT = { kind: 'project' as const, project_ref: { project_id: 'sample' } }

// The page reports each opening to the server. There is none here, so the report fails
// and is dropped, as it is whenever its write fails.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(() => Promise.reject(new TypeError('no server'))),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('opens the Analytics page on the stage', async () => {
    const stage = mount(AppModuleStage, {
      props: {
        activeModule: 'analytics',
        context: null,
        locale: 'en',
        moduleTitle: 'Analytics',
        primaryWriteScopeId: null,
        questionAsked: false,
        route: { module_id: 'analytics', scope: PROJECT },
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
  })
})

describe('the Analytics page', () => {
  it('says that usage appears once it is collected, and shows no figure', () => {
    const page = mount(AnalyticsView, { global: { plugins: [i18n()] } })
    const empty = page.get('[role="status"]')
    expect(empty.text()).toContain('No usage collected yet')
    expect(empty.text()).toContain('will appear here once Valkama collects them')
    expect(page.text()).not.toMatch(/\d/)
    expect(page.find('svg:not(.empty-mark), canvas').exists()).toBe(false)
  })

  it('says the same in Russian', () => {
    const page = mount(AnalyticsView, { global: { plugins: [i18n('ru')] } })
    expect(page.text()).toContain('Расход ещё не собран')
    expect(page.text()).toContain('появятся здесь')
  })

  it('waits and fails through the shared state panel', async () => {
    const loading = mount(AnalyticsView, {
      props: { state: uiLoading<never>() },
      global: { plugins: [i18n()] },
    })
    expect(loading.find('[aria-busy="true"]').exists()).toBe(true)

    const failed = mount(AnalyticsView, {
      props: { state: uiError<never>('The usage read failed.') },
      global: { plugins: [i18n()] },
    })
    expect(failed.get('[role="alert"]').text()).toContain('The usage read failed.')
    await failed.get('.platform-state-retry').trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
  })
})
