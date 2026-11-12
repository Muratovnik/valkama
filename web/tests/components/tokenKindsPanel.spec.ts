/**
 * The panel of the tokens by kind on an answer as the read gives it. The oracle is the summary's
 * rule: the counted kinds add up to the «Tokens» figure, the cache reads and the reasoning stand
 * apart from that sum, and an answer without its period before has no column for it and says so.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TokenKindsPanel from '@/pages/analytics/components/TokenKindsPanel.vue'

import { serveUsage, task } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'

/** A week of three days, a task a day, compared with the week before when `compare` is set. */
function usageOf(compare: boolean) {
  const query = new URLSearchParams({
    from: '2026-11-09',
    to: '2026-11-12',
    step: 'day',
    utc_offset: '0',
    group_by: 'work_item',
    ...(compare ? { compare: 'true' } : {}),
  })
  const stretches = [0, 1, 2, -2].map((day, index) => ({
    at: new Date(Date.UTC(2026, 10, 9 + day, 10)),
    group: { work_item: task(index + 1, `Task ${index + 1}`) },
    spend: { seconds: 600, tokens: 2_000_000 },
  }))
  return serveUsage(stretches, query).usage
}

const mountPanel = (compare: boolean, locale: 'en' | 'ru' = 'en') =>
  mount(TokenKindsPanel, {
    props: { usage: usageOf(compare) },
    global: { plugins: [analyticsI18n(locale)] },
  })

const rows = (panel: ReturnType<typeof mountPanel>) =>
  panel
    .findAll('.kinds-table tbody tr')
    .map((row) => row.findAll('th, td').map((cell) => cell.text()))

describe('the panel of the tokens by kind', () => {
  it('sums the counted kinds into the tokens figure and sets the cache reads apart', () => {
    const panel = mountPanel(true)
    // Six million anew: half input, three tenths output, the rest written to the cache.
    expect(panel.get('.kinds-figure-value').text()).toBe('6M')
    expect(rows(panel)).toEqual([
      ['Input', '3M', '1M', '↑ 200%'],
      ['Output', '1.8M', '600K', '↑ 200%'],
      ['Cache write, 5 min', '1.2M', '400K', '↑ 200%'],
      ['Total', '6M', ''],
      ['Cache read, not counted', '60M', '20M', '↑ 200%'],
      ['Reasoning, part of output', '600K', '200K', '↑ 200%'],
    ])
    expect(panel.find('.spending-unread').exists()).toBe(false)
  })

  it('has no column of the period before when it was not read, and says so', () => {
    const panel = mountPanel(false)
    expect(panel.find('.spending-unread').exists()).toBe(true)
    expect(panel.findAll('.kinds-table thead th').map((cell) => cell.text())).toEqual([
      'Kind',
      'Tokens',
    ])
  })

  it('names the kinds in Russian, the cache reads as not counted', () => {
    const panel = mountPanel(true, 'ru')
    expect(rows(panel).map((row) => row[0])).toEqual([
      'Вход',
      'Выход',
      'Запись в кэш, 5 мин',
      'Итого',
      'Чтение кэша, не учтено',
      'Рассуждения, часть выхода',
    ])
  })
})
