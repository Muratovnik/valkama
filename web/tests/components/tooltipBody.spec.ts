/**
 * A hint with a structure is drawn as a grid by the window's one hint host: its head with its
 * figure, its quiet rows, a row for each part with its hue, figure and share, and its notes, each
 * a cell of its own; what assistive technology reads is still the hint's text. Inside an area, the
 * row of the part focus stands on is marked, and moving focus to another part moves the mark and
 * keeps the hint. The hint once ran all of it together as lines of words.
 */
import { defineComponent, h, nextTick, withDirectives } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { TooltipBody } from '@/shared/ui/tooltipAnchors.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import TooltipHost from '@/shared/ui/TooltipHost.vue'

const TEXT = 'Monday: total 3 h, before 1 h\nSwitched to B\nB 2 h, 67% of the total\nA 1 h'

const BODY: TooltipBody = {
  head: { name: 'Monday', figure: '3 h' },
  quiet: [{ name: 'before', figure: '1 h' }],
  rows: [
    { key: 'b', slot: 2, name: 'B', figure: '2 h', share: '67%' },
    { key: 'a', slot: 1, name: 'A', figure: '1 h', share: '33%' },
  ],
  notes: ['Switched to B'],
}

/** An area as a chart's period is one: the period carries the hint, its parts stand for rows. */
const surface = defineComponent({
  props: { body: { type: Object as () => TooltipBody, required: true } },
  render() {
    return h('main', [
      h('div', { 'class': 'area', 'data-tooltip-area': '' }, [
        withDirectives(h('div', { class: 'period', tabindex: 0, role: 'img' }), [
          [vTooltip, { text: TEXT, body: this.body }, undefined, { detail: true }],
        ]),
        h('button', { 'class': 'part-b', 'data-tooltip-row': 'b' }, 'b'),
        h('button', { 'class': 'part-a', 'data-tooltip-row': 'a' }, 'a'),
      ]),
      h(TooltipHost),
    ])
  },
})

let mounted: { unmount: () => void } | null = null

/** Focus a key brings to `selector`, and the hint it holds up once drawn. */
async function focusByKey(selector: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
  document.querySelector<HTMLElement>(selector)?.focus()
  await flushPromises()
  await nextTick()
  return document.querySelector('.tooltip-hint')
}

const cells = (hint: Element | null, selector: string) =>
  [...(hint?.querySelectorAll(selector) ?? [])].map((cell) => cell.textContent)

afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

describe('a hint drawn as a grid', () => {
  it('draws its head, quiet rows, main rows and notes, each in cells, and reads its text', async () => {
    mounted = mount(surface, { props: { body: BODY }, attachTo: document.body })
    const hint = await focusByKey('.period')
    expect(hint?.classList).toContain('tooltip-hint-body')
    const head = hint?.querySelector('.tooltip-body-head')
    expect(cells(head ?? null, 'span')).toEqual(['Monday', '3 h'])
    expect(cells(hint, '.tooltip-body-quiet span')).toEqual(['before', '1 h'])
    const rows = [...(hint?.querySelectorAll('.tooltip-body-main') ?? [])].map((row) => ({
      slot: row.querySelector<HTMLElement>('.tooltip-body-swatch')?.dataset.slot,
      cells: cells(row, '.tooltip-body-name, .tooltip-body-figure, .tooltip-body-share'),
    }))
    expect(rows).toEqual([
      { slot: '2', cells: ['B', '2 h', '67%'] },
      { slot: '1', cells: ['A', '1 h', '33%'] },
    ])
    expect(cells(hint, '.tooltip-body-note')).toEqual(['Switched to B'])
    // The swatch is the legend's hue mapping, and the grid has a column for it and for shares.
    expect(hint?.querySelector('.tooltip-body-swatch')?.classList).toContain('series-fill')
    const grid = [...(hint?.querySelector('.tooltip-body')?.classList ?? [])]
    expect(grid).toEqual(expect.arrayContaining(['tooltip-body-swatches', 'tooltip-body-shares']))
    // What a screen reader is given is the hint's words, not its cells run together.
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(TEXT)
    // On the period's own ground no row is the current one.
    expect(hint?.querySelectorAll('.tooltip-body-current')).toHaveLength(0)
  })

  it('marks the row of the part focus stands on, and moves the mark with it in the same hint', async () => {
    mounted = mount(surface, { props: { body: BODY }, attachTo: document.body })
    const first = await focusByKey('.period')
    const onB = await focusByKey('.part-b')
    const marked = () =>
      [...document.querySelectorAll<HTMLElement>('.tooltip-body-current')].map(
        (row) => row.dataset.row,
      )
    expect(marked()).toEqual(['b'])
    const onA = await focusByKey('.part-a')
    expect(marked()).toEqual(['a'])
    await focusByKey('.period')
    expect(marked()).toEqual([])
    expect(onB).toBe(first)
    expect(onA).toBe(first)
  })

  it('has no swatch or share column where no row has one', async () => {
    const plain: TooltipBody = {
      head: { name: 'Monday' },
      rows: [{ name: 'B', figure: '2 h' }],
    }
    mounted = mount(surface, { props: { body: plain }, attachTo: document.body })
    const hint = await focusByKey('.period')
    const grid = [...(hint?.querySelector('.tooltip-body')?.classList ?? [])]
    expect(grid).toContain('tooltip-body')
    expect(grid).not.toContain('tooltip-body-swatches')
    expect(grid).not.toContain('tooltip-body-shares')
    expect(hint?.querySelectorAll('.tooltip-body-swatch, .tooltip-body-share')).toHaveLength(0)
    expect(cells(hint, '.tooltip-body-head span')).toEqual(['Monday'])
  })
})
