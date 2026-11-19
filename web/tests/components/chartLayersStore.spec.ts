/**
 * Which layers the charts draw beside their data, as this computer keeps them. The oracle is the
 * owner's decision for the layers (DESIGN, Analytics): every layer shows until a reader turns it
 * off; one choice per layer holds for every chart at once; it survives a reload, which is a new
 * store reading what the last one kept; and a kept value this build cannot read — broken, of
 * another shape, or naming a layer no chart draws — hides nothing rather than a layer the reader
 * never turned off.
 */
import { createPinia, setActivePinia } from 'pinia'

import { beforeEach, describe, expect, it } from 'vitest'

import { useChartLayer, useChartLayersStore } from '@/shared/stores/chartLayersStore.ts'

const KEY = 'valkama-chart-layers'
const EVERY = ['outline', 'change', 'even', 'ahead'] as const

/** The page loaded again: a new store, which reads what the device kept. */
function reloaded() {
  setActivePinia(createPinia())
  return useChartLayersStore()
}

const shownOf = (layers: ReturnType<typeof useChartLayersStore>) =>
  EVERY.filter((layer) => layers.shown(layer))

describe('the layers the charts draw', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows every layer on a device that kept no choice, and keeps nothing until one is made', () => {
    expect(shownOf(reloaded())).toEqual([...EVERY])
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('turns one layer off and on again, the others left as they were', () => {
    const layers = reloaded()
    layers.toggle('outline')
    expect(shownOf(layers)).toEqual(['change', 'even', 'ahead'])
    layers.toggle('ahead')
    expect(shownOf(layers)).toEqual(['change', 'even'])
    layers.toggle('outline')
    expect(shownOf(layers)).toEqual(['outline', 'change', 'even'])
    layers.toggle('ahead')
    expect(shownOf(layers)).toEqual([...EVERY])
  })

  it('is one choice for every chart: a key read through another holder sees the same press', () => {
    const fromLegend = useChartLayer('outline')
    const fromChart = useChartLayer('outline')
    expect(fromChart.shown.value).toBe(true)
    fromLegend.toggle()
    expect(fromChart.shown.value).toBe(false)
    expect(useChartLayer('change').shown.value).toBe(true)
  })

  it('keeps the choice on the device, and a reload reads it back until it is turned on again', () => {
    reloaded().toggle('outline')
    reloaded().toggle('even')
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(['outline', 'even'])
    const again = reloaded()
    expect(shownOf(again)).toEqual(['change', 'ahead'])
    again.toggle('outline')
    expect(shownOf(reloaded())).toEqual(['outline', 'change', 'ahead'])
  })

  it.each([
    ['broken text', '["outline"'],
    ['an object', '{"outline":false}'],
    ['a string', '"outline"'],
    ['null', 'null'],
    ['a layer no chart draws', '["series"]'],
  ])('shows every layer where the device kept %s', (_, kept) => {
    localStorage.setItem(KEY, kept)
    expect(shownOf(reloaded())).toEqual([...EVERY])
  })

  it('reads the layers it knows from a value that also names one it does not', () => {
    localStorage.setItem(KEY, '["series","change","change",7]')
    expect(shownOf(reloaded())).toEqual(['outline', 'even', 'ahead'])
  })
})
