/**
 * The line of a change at a period's start (`PeriodColumns`), keyed and named. The oracle is
 * DESIGN (Analytics, the period chart): while the plot marks a change the legend names its line
 * (`words.change`) beside a short upright line, a key of a mark and no series, and drops the key
 * once none is; a period that acts is named by its action and then by the change at its start,
 * so a screen reader hears what the line says without the hint.
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { PeriodColumn, PeriodMark, PeriodWords } from '@/shared/ui/chartGeometry.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'

const words: PeriodWords = {
  total: 'total',
  incomplete: 'so far',
  hatch: 'in progress',
  period: 'Hour',
  note: 'Note',
  empty: 'Nothing in this range.',
  change: 'account change',
}

/** Three hours of one series, each a control that narrows to itself, none still running. */
const columns: PeriodColumn[] = ['09', '10', '11'].map((hour) => ({
  key: hour,
  label: `${hour}:00`,
  fullLabel: `${hour}:00`,
  values: { work: 1 },
  action: `Show ${hour}:00`,
}))

const marks: PeriodMark[] = [{ at: '10', label: 'Account change: +B' }]

const mounted: { unmount: () => void }[] = []
afterEach(() => {
  for (const one of mounted.splice(0)) one.unmount()
})

function mountHours(props: { marks?: PeriodMark[]; words?: PeriodWords } = {}) {
  const chart = mount(PeriodColumns, {
    attachTo: document.body,
    props: {
      label: 'Time per hour',
      columns,
      series: [{ key: 'work', label: 'work', slot: 1 }],
      words,
      marks,
      formatValue: (value: number) => `${value} h`,
      ...props,
    },
  })
  mounted.push(chart)
  return chart
}

const key = (chart: ReturnType<typeof mountHours>) =>
  chart.findAll('[data-hint-list="legend"] [data-mark="change"]')

describe('the line of a change at a period’s start', () => {
  it('is keyed in the legend while the plot marks one, though one series needs no key', () => {
    const chart = mountHours()
    expect(chart.findAll('[data-region="field"] [data-mark="change"]')).toHaveLength(1)
    expect(key(chart)).toHaveLength(1)
    expect(key(chart)[0]?.text()).toBe('account change')
    // A key of a mark, not of a series: nothing reading the series reads it.
    expect(chart.findAll('[data-hint-list="legend"] [data-series]')).toHaveLength(0)
  })

  it('is keyed nowhere once no period is marked, and the lone series keeps no legend', () => {
    const chart = mountHours({ marks: [] })
    expect(chart.findAll('[data-region="field"] [data-mark="change"]')).toHaveLength(0)
    expect(key(chart)).toHaveLength(0)
    expect(chart.find('[data-hint-list="legend"]').exists()).toBe(false)
  })

  it('names a period that acts by its action and then the change at its start', () => {
    const names = mountHours()
      .findAll('[data-tooltip-area] button')
      .map((one) => one.attributes('aria-label'))
    expect(names).toEqual(['Show 09:00', 'Show 10:00. Account change: +B', 'Show 11:00'])
  })
})
