/**
 * The chain's history one action away: folded until asked, opened and closed from
 * one button that says so, and with no history to draw, the pace alone with nothing
 * to fold.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ChainDetails from '@/widgets/work-item-inspector/components/ChainDetails.vue'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

const SERIES = [
  { day: '2026-10-01', created: 3, closed: 0, total: 3, closed_total: 0 },
  { day: '2026-10-05', created: 1, closed: 2, total: 4, closed_total: 2 },
]

function details(series: readonly (typeof SERIES)[number][], open = false) {
  const wrapper = mount(ChainDetails, {
    props: {
      open,
      'pace': 'Last 7 days: +4 added, −2 done',
      series,
      'onUpdate:open': (next: boolean) => wrapper.setProps({ open: next }),
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages, pluralRules })] },
  })
  return wrapper
}

describe('a chain’s details', () => {
  it('stands folded, and one press shows the pace and the chart', async () => {
    const wrapper = details(SERIES)
    const toggle = wrapper.get('button')
    expect(toggle.text()).toBe('Chart and pace')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    // Nothing drawn, so nothing named as drawn.
    expect(toggle.attributes('aria-controls')).toBeUndefined()
    expect(wrapper.find('.chain-pace').exists()).toBe(false)
    expect(wrapper.find('.chain-chart').exists()).toBe(false)

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.chain-pace').text()).toBe('Last 7 days: +4 added, −2 done')
    const body = wrapper.get('.chain-details-body')
    expect(toggle.attributes('aria-controls')).toBe(body.attributes('id'))
    expect(wrapper.get('.chain-chart').attributes('aria-label')).toContain('4 now')

    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.chain-chart').exists()).toBe(false)
  })

  it('holds what its host says is open', () => {
    const wrapper = details(SERIES, true)
    expect(wrapper.find('.chain-chart').exists()).toBe(true)
  })

  it('folds nothing where one day is no history to draw', () => {
    const wrapper = details(SERIES.slice(0, 1))
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('.chain-chart').exists()).toBe(false)
    expect(wrapper.get('.chain-pace').text()).toBe('Last 7 days: +4 added, −2 done')
  })
})
