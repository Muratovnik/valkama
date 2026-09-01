import { nextTick } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AnalyticsFilterBar from '@/widgets/analytics-dashboard/components/AnalyticsFilterBar.vue'

import { messages } from '@/shared/i18n/index.ts'

import { present } from '../support/present.ts'

const i18n = createI18n({ legacy: false, locale: 'ru', fallbackLocale: 'en', messages })

const facets = { agents: [], clients: [], environments: [], tools: [] }

function mountBar() {
  return mount(AnalyticsFilterBar, {
    global: { plugins: [i18n] },
    props: { facets, applied: null },
  })
}

describe('the analytics filter bar owns exactly the filters it shows', () => {
  it('resets every filter it applied', async () => {
    const bar = mountBar()

    // What the server echoes after a date filter was applied: exactly the same
    // canonical spelling the form owns.
    await bar.setProps({
      applied: {
        epic: null,
        client: null,
        agent: null,
        environment: null,
        tool: null,
        status: null,
        date_from: '2026-08-01T00:00:00Z',
        date_to: null,
        as_of: null,
      } as never,
    })
    await nextTick()
    expect(bar.findAll('.filter-chip')).toHaveLength(1)

    await bar.get('.filter-reset').trigger('click')

    const applied = present(bar.emitted('apply'), 'an apply event')
    const last = present(applied.at(-1), 'the last apply payload')[0] as Record<string, unknown>
    // The request serializes every key it is handed, so the emitted shape must
    // stay the exact canonical contract.
    expect(last.date_from).toBeNull()
    expect(last.from).toBeUndefined()
    expect(Object.values(last).every((value) => value === null)).toBe(true)
  })
})
