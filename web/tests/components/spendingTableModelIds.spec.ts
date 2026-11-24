/**
 * A model's id in the Model section's table is never cut (the owner's decision of 2026-11-24): the
 * heading of the names holds the room of each id the rows name, so the column is as wide as the
 * longest; the id stands on one line, unclamped and uncut, alone or as the first value of a pair,
 * whose other value beside it is cut at its own end. Alone in its row, the id's column is the
 * table's to size by its room alone (`data-rows`). A section of free text keeps its names cut
 * on one line, its heading holding no room. A cost with no price at all is words, which the
 * table lays on one line or wraps as it fits (`useHeadingLines`, `headingLines.spec.ts`).
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'

import { task, usageAnswer, value } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

const ALPHA = task(1, 'Alpha')

const BY_MODEL: Stretch[] = [
  {
    day: 0,
    group: { model: value('claude-fable-5-1') },
    spend: { seconds: 7200, tokens: 2000, cost: 1.5 },
  },
  {
    day: 0,
    group: { model: value('claude-fable-5-2') },
    spend: { seconds: 3600, tokens: 500, cost: null, unpriced: 500 },
  },
  { day: 1, group: { model: value('model-a') }, spend: { seconds: 1800, tokens: 100, cost: 0.1 } },
]

const BY_MODEL_AND_TASK: Stretch[] = [
  {
    day: 0,
    group: { model: value('claude-fable-5-1'), work_item: ALPHA },
    spend: { seconds: 3600 },
  },
]

function table(by: UsageDimension, stretches: Stretch[], across: UsageDimension | null = null) {
  const groupBy: UsageDimension[] = across ? [by, across] : [by]
  const usage = usageAnswer({ first: new Date(2026, 10, 9), days: 2, groupBy, stretches }).usage
  const cross = across ? { status: 'ready' as const, usage } : { status: 'off' as const }
  return mount(SpendingTable, {
    props: { across, by, cross, filters: {}, measure: 'time' as const, usage },
    global: { plugins: [analyticsI18n()] },
  })
}

describe('a model id in the Model section’s table', () => {
  it('holds each id the rows name in the names’ heading, unseen, once', () => {
    const wrapper = table('model', BY_MODEL)
    const room = wrapper.findAll('thead th')[0]?.findAll('.column-room') ?? []
    expect(room.map((word) => word.text())).toEqual([
      'claude-fable-5-1',
      'claude-fable-5-2',
      'model-a',
    ])
    expect(room.every((word) => word.attributes('aria-hidden') === 'true')).toBe(true)
    // The figures' headings hold none.
    expect(
      wrapper
        .findAll('thead th')
        .slice(1)
        .flatMap((cell) => cell.findAll('.column-room')),
    ).toEqual([])
    // The heading still reads as its words alone.
    expect(wrapper.get('thead th .table-sort').text()).toBe('Model')
  })

  it('draws each id whole on one line, neither cut nor clamped', () => {
    const wrapper = table('model', BY_MODEL)
    expect(wrapper.attributes('data-rows')).toBe('ids')
    const names = wrapper.findAll('tbody th')
    expect(names).toHaveLength(3)
    for (const name of names) {
      expect(name.find('.whole-words').exists()).toBe(true)
      expect(name.find('.one-line').exists()).toBe(false)
      expect(name.find('.two-lines').exists()).toBe(false)
    }
  })

  it('keeps the id of a pair whole, its other value beside it', () => {
    const wrapper = table('model', BY_MODEL_AND_TASK, 'work_item')
    expect(wrapper.attributes('data-rows')).toBe('pairs')
    const pair = wrapper.get('tbody th .pair-name')
    expect(pair.classes()).toContain('pair-whole')
    expect(pair.get('.pair-start').text()).toBe('claude-fable-5-1')
    expect(pair.get('.pair-end').text()).toBe('· MAIN-1 Alpha')
    const room = wrapper.findAll('thead th')[0]?.findAll('.column-room') ?? []
    expect(room.map((word) => word.text())).toEqual(['claude-fable-5-1'])
  })

  it('leaves a section of free text cut on one line, its heading holding no room', () => {
    const wrapper = table('work_item', [
      { day: 0, group: { work_item: ALPHA }, spend: { seconds: 3600 } },
    ])
    expect(wrapper.attributes('data-rows')).toBe('values')
    expect(wrapper.find('.column-room').exists()).toBe(false)
    expect(wrapper.find('tbody th .whole-words').exists()).toBe(false)
    expect(wrapper.find('tbody th .one-line').exists()).toBe(true)
  })

  it('marks a cost with no price at all as words with a count, and an amount not', () => {
    const wrapper = table('model', BY_MODEL)
    const costs = wrapper.findAll('tbody td[data-measure="cost"]')
    const unpriced = costs.find((cell) => cell.text().includes('without a price'))
    expect(unpriced?.find('.figure-words').exists()).toBe(true)
    const priced = costs.find((cell) => cell.text().includes('$1.50'))
    expect(priced?.find('.figure-words').exists()).toBe(false)
  })

  it('leaves a label of words with no count, «No tokens», to keep its line', () => {
    const wrapper = table('model', [
      { day: 0, group: { model: value('model-a') }, spend: { seconds: 600 } },
    ])
    const tokens = wrapper.get('tbody td[data-measure="tokens"]')
    expect(tokens.text()).toBe('No tokens')
    expect(tokens.find('.figure-words').exists()).toBe(false)
  })
})
