/**
 * The panel of the tokens by kind on an answer as the read gives it. The oracle is the summary's
 * rule: the counted kinds add up to the «Tokens» figure, the cache reads and the reasoning stand
 * apart from that sum, and an answer without its period before has no column for it and says so.
 * Its chart is a ring of the counted kinds alone, each in its kind's hue, the kinds apart named
 * with their figures beside it and no part of its whole; switched to ranked bars, the same kinds
 * in the same hues, each bar's share a share of the counted kinds alone.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TokenKindsPanel from '@/pages/analytics/components/TokenKindsPanel.vue'

import { serveUsage, task } from '../fixtures/analytics.ts'
import { analyticsI18n } from '../support/analyticsReads.ts'
import { showView, viewsOf } from '../support/chartViews.ts'

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
      ['Cache read', '60M', '20M', '↑ 200%'],
      ['Reasoning', '600K', '200K', '↑ 200%'],
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

  it('names the kinds in Russian, the ones apart under the total', () => {
    const panel = mountPanel(true, 'ru')
    expect(rows(panel).map((row) => row[0])).toEqual([
      'Вход',
      'Выход',
      'Запись в кэш, 5 мин',
      'Итого',
      'Чтение кэша',
      'Рассуждения',
    ])
  })
})

describe('the ring of the tokens by kind', () => {
  it('draws the counted kinds as its sectors and lists the kinds apart under its legend', () => {
    const panel = mountPanel(true)
    const ring = panel.get('.kinds-bars .donut-chart')

    // Each counted kind in its own hue, wherever the page draws it (`KIND_SLOTS`).
    expect(
      ring
        .findAll('.donut-sector')
        .map((one) => [one.attributes('data-key'), one.attributes('data-slot')]),
    ).toEqual([
      ['input', '1'],
      ['output', '4'],
      ['cache_write_5m', '2'],
    ])
    expect(ring.findAll('.chart-key-name').map((one) => one.text())).toEqual([
      'Input',
      'Output',
      'Cache write, 5 min',
    ])
    // The cache reads and the reasoning are no part of the ring's whole: notes under its legend.
    expect(ring.findAll('.donut-note').map((one) => one.text())).toEqual([
      'Cache read60M',
      'Reasoning600K',
    ])
  })

  it('opens on the ring, and as bars ranks the same kinds, their shares of the counted tokens', async () => {
    const panel = mountPanel(true)
    expect(viewsOf(panel, '.kinds-bars')).toEqual({
      offered: ['Ring', 'Bars', 'Table'],
      shown: 'Ring',
    })
    const shares = panel
      .findAll('.kinds-bars .chart-figure')
      .map((one) => one.text().split(' · ')[1])

    await showView(panel, '.kinds-bars', 'Bars')
    const bars = panel.get('.kinds-bars .ranked-bars')
    expect(
      bars
        .findAll('.ranked-list:not(.ranked-rest) .ranked-row')
        .map((row) => [
          row.get('.ranked-label').text(),
          row.get('.ranked-bar').attributes('data-slot'),
        ]),
    ).toEqual([
      ['Input', '1'],
      ['Output', '4'],
      ['Cache write, 5 min', '2'],
    ])
    // The kinds apart close the bars by name and figure, with no bar and in no share.
    expect(bars.findAll('.ranked-rest .ranked-row').map((row) => row.text())).toEqual([
      'Cache read60M',
      'Reasoning600K',
    ])
    const hinted = bars
      .findAll('.ranked-list:not(.ranked-rest) .ranked-line')
      .map((line) => line.attributes('data-tooltip'))
    expect(hinted.map((hint, at) => hint?.includes(`${shares[at]} of the total`))).toEqual([
      true,
      true,
      true,
    ])
  })
})
