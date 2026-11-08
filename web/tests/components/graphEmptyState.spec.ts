import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GraphEmptyState from '@/widgets/work-item-graph/components/GraphEmptyState.vue'

import { messages } from '@/shared/i18n/index.ts'

const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })

const mountEmpty = (kind: 'open' | 'space', count = 0) =>
  mount(GraphEmptyState, { global: { plugins: [i18n] }, props: { kind, count } })

/**
 * The graph's two empties are said by the shared empty state: a space with no work offers
 * nothing, and a space whose work is all done offers to show it, through the state's action.
 */
describe('the empty graph', () => {
  it('says a space has no work and offers nothing', () => {
    const empty = mountEmpty('space')

    expect(empty.get('.data-empty .empty-title').text()).toBe('This space has no work to project.')
    expect(empty.find('button').exists()).toBe(false)
  })

  it('offers the finished work it hides, and asks for it when pressed', async () => {
    const empty = mountEmpty('open', 3)

    expect(empty.get('.data-empty .empty-title').text()).toBe('No open work to draw.')
    const reveal = empty.get('.data-empty button')
    expect(reveal.text()).toBe('Show done · 3')
    await reveal.trigger('click')
    expect(empty.emitted('reveal')).toHaveLength(1)
  })
})
