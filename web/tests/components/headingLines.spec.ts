/**
 * The steps a table gives its width by (`useHeadingLines`): its headings over figures on one line
 * while the table fits its frame so, then on two; and in a table that asks it, the Model
 * section's, its figures' words on one line while the table, its headings on two if they must,
 * still fits on one, wrapped only past that. The oracle is the requirement, with a table whose
 * width at each step is written out by hand: 900 pixels with everything on one line, 800 with its
 * headings on two, 700 with its words wrapped as well.
 */
import { defineComponent, h, nextTick, ref } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { useHeadingLines } from '@/pages/analytics/composables/useHeadingLines.ts'

/** The table's width at a step, as the step's attributes on its section say it. */
function widthAt(section: HTMLElement) {
  if (section.dataset.figures === 'wrap') return 700
  return section.dataset.headings === 'two' ? 800 : 900
}

function table(frameWidth: number, wraps: boolean) {
  const holds = ref(0)
  const frame = ref(frameWidth)
  let measured = 0
  const Host = defineComponent({
    setup() {
      const box = ref<HTMLElement | null>(null)
      const lines = useHeadingLines(box, [holds], () => wraps)
      return () =>
        h('section', { 'ref': box, 'data-lines': JSON.stringify(lines.value) }, [
          h('div', { class: 'chart-table-frame' }, [h('table')]),
        ])
    },
  })
  const wrapper = mount(Host)
  const section = wrapper.element as HTMLElement
  const frameBox = section.querySelector('.chart-table-frame') as HTMLElement
  Object.defineProperty(frameBox, 'clientWidth', { get: () => frame.value })
  Object.defineProperty(section.querySelector('table'), 'offsetWidth', {
    get: () => {
      measured++
      return widthAt(section)
    },
  })
  /** What the table holds changes, so it is fitted again. */
  const refit = async () => {
    holds.value++
    await nextTick()
    await nextTick()
  }
  const state = () => ({
    lines: JSON.parse(section.dataset.lines ?? '{}') as unknown,
    figures: section.dataset.figures,
    headings: section.dataset.headings,
  })
  return { frame, measured: () => measured, refit, state }
}

describe('the lines a table’s headings and figures take', () => {
  it('keeps everything on one line where the frame holds the table so', async () => {
    const shown = table(900, true)
    await shown.refit()
    expect(shown.state()).toEqual({
      lines: { figures: 'one', headings: 'one' },
      figures: 'one',
      headings: 'one',
    })
  })

  it('puts the headings on two lines before it wraps a word of the figures', async () => {
    const shown = table(850, true)
    await shown.refit()
    expect(shown.state()).toMatchObject({ figures: 'one', headings: 'two' })
  })

  it('wraps the figures’ words only where the headings on two lines are not enough', async () => {
    const shown = table(750, true)
    await shown.refit()
    expect(shown.state()).toMatchObject({ figures: 'wrap', headings: 'two' })
    // The narrowest step is what is left: it is never measured.
    expect(shown.measured()).toBe(2)
  })

  it('wraps the words of no other section’s table, and sets no step for them', async () => {
    const shown = table(750, false)
    await shown.refit()
    expect(shown.state()).toEqual({
      lines: { figures: null, headings: 'two' },
      figures: undefined,
      headings: 'two',
    })
  })
})
