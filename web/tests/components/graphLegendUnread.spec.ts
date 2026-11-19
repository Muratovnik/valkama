/**
 * The graph's key says which spaces' links were not read, by key where a link names it,
 * and a screen reader hears that line, while the key to the marks stays hidden from it.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GraphLegend from '@/widgets/work-item-graph/components/GraphLegend.vue'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

const NAMES = {
  ready: null,
  active: null,
  triage: null,
  deferred: null,
  review: null,
  blocked: null,
  done: null,
  containers: null,
}

function legend(unread: string[], locale: 'en' | 'ru' = 'ru') {
  return mount(GraphLegend, {
    props: { groups: [], names: NAMES, hasEdges: true, keepDone: false, unread },
    global: { plugins: [createI18n({ legacy: false, locale, messages, pluralRules })] },
  })
}

describe('the key of a graph whose links with a space were not read', () => {
  it('names each such space, and another one where no link names it', () => {
    const wrapper = legend(['', 'GAMMA'])
    expect(wrapper.findAll('.graph-legend-unread').map((entry) => entry.text())).toEqual([
      'Связи с другим пространством не прочитаны',
      'Связи с GAMMA не прочитаны',
    ])
    expect(legend(['GAMMA'], 'en').get('.graph-legend-unread').text()).toBe(
      'Links with GAMMA were not read',
    )
  })

  it('is heard, and the key to the lines is not', () => {
    const wrapper = legend(['GAMMA'])
    expect(wrapper.get('.graph-legend').attributes('aria-hidden')).toBeUndefined()
    expect(wrapper.get('.graph-legend-unread').attributes('aria-hidden')).toBeUndefined()
    const marks = wrapper.findAll('.graph-legend-item:not(.graph-legend-unread)')
    expect(marks.length).toBeGreaterThan(0)
    for (const mark of marks) expect(mark.attributes('aria-hidden')).toBe('true')
  })

  it('says nothing of the kind when every link was read', () => {
    expect(legend([]).find('.graph-legend-unread').exists()).toBe(false)
  })
})
