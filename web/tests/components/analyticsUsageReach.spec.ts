/**
 * Whether a task's side panel in Analytics reads the task's figures of all time, as the shell
 * decides it. The oracle is the card's own rule: a card reads its item's usage only where its
 * store is the primary one writes go to, and asks nothing otherwise. Analytics names the primary
 * store's tasks, so the panel asks where the primary store takes writes and, where it does not,
 * asks nothing and has no figures of all time, never a failed read in their place.
 */
import { defineComponent, h } from 'vue'
import type { PropType } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppModuleStage from '@/app/components/AppModuleStage.vue'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { messages, pluralRules } from '@/shared/i18n/index.ts'
import { provideReferenceLinks } from '@/shared/lib/referenceLinks.ts'

import { serveUsage, task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { stubAnalyticsReads } from '../support/analyticsReads.ts'

vi.mock('@/pages/analytics/composables/useRailReads.ts', () => import('../support/quietRail.ts'))
vi.mock('@/shared/api/analyticsUses.ts', () => ({ reportAnalyticsUse: vi.fn() }))

const NOW = new Date(2026, 10, 11, 14, 30)
const ITEM = task(7, 'Sort the answers')
const WORLD: TimedStretch[] = [
  { at: new Date(2026, 10, 9, 10), group: { work_item: ITEM }, spend: { seconds: 3600 } },
]
const SCOPE = { kind: 'global' as const }
/** The primary store, as the shell's context names it; no project is needed here. */
const context = {
  primary: { data_scope_id: 'store-a' },
  projects: [],
} as unknown as PlatformContextReady

/** Opening a task from the page: nothing to follow here. */
const stay = () => {}

/** The stage under a layer that resolves task references, as the shell provides one. */
const Shell = defineComponent({
  props: { primaryWriteScopeId: { type: String as PropType<string | null>, default: null } },
  setup(props) {
    provideReferenceLinks((reference, parent) =>
      reference.kind === 'work-item'
        ? { title: reference.value, href: `/open/${reference.value}`, open: stay }
        : parent(reference),
    )
    return () =>
      h(AppModuleStage, {
        activeModule: 'analytics',
        context,
        locale: 'en',
        moduleTitle: 'Analytics',
        primaryWriteScopeId: props.primaryWriteScopeId,
        questionAsked: false,
        route: {
          module_id: 'analytics',
          scope: SCOPE,
          state: { by: 'work_item', detail: JSON.stringify({ by: 'work_item', value: ITEM.id }) },
        },
        scope: SCOPE,
        stateBytes: 2048,
      })
  },
})

const mountStage = (primaryWriteScopeId: string | null) =>
  mount(Shell, {
    props: { primaryWriteScopeId },
    attachTo: document.body,
    global: {
      plugins: [
        createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages, pluralRules }),
      ],
    },
  })

/** The card's usage reads the page asked, by their queries. */
const usageAsked = () =>
  vi
    .mocked(globalThis.fetch)
    .mock.calls.map(([input]) => new URL(input as string, 'http://127.0.0.1'))
    .filter((url) => url.pathname === '/api/planning/work-item/usage')
    .map((url) => Object.fromEntries(url.searchParams))

describe('a task’s figures of all time, by the store its card reads', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    stubAnalyticsReads((query) => serveUsage(WORLD, query))
  })
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('reads them where the primary store takes writes, as the card does', async () => {
    const stage = mountStage('store-a')
    await vi.dynamicImportSettled()
    await flushPromises()
    expect(usageAsked()).toEqual([{ id: 'MAIN-7', scope: 'item' }])
    expect(document.querySelector('[data-part="all-time"]')).not.toBeNull()
    stage.unmount()
  })

  it('asks nothing and has none where it does not, as the card asks nothing', async () => {
    const stage = mountStage(null)
    await vi.dynamicImportSettled()
    await flushPromises()
    // The panel is open, with its figures of the period.
    expect(document.querySelector('[data-part="figures"]')).not.toBeNull()
    expect(usageAsked()).toEqual([])
    expect(document.querySelector('[data-part="all-time"]')).toBeNull()
    stage.unmount()
  })
})
