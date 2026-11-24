import { defineComponent, h, nextTick, ref } from 'vue'

/**
 * How a table stands in its frame (`useTableFit`), against a layout that gives each table the width
 * it takes at each step. The oracle is DESIGN.md, Rows and tables: whether the columns fit the frame
 * decides the step, never the window — the first of the page's steps at which every table of the
 * box stands inside its frame, and where none does, the page's answer (a table of figures scrolls
 * at its second step, one of words stacks, one whose cells the page lets wrap wraps them). A step
 * known to run past a frame is not laid out again while what the table holds is the same, and is
 * once it changes.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTableFit } from '@/widgets/section-table/composables/useTableFit.ts'
import type { TableFit, TableFitRule } from '@/widgets/section-table/composables/useTableFit.ts'

/** What a frame's scrollbar takes: its whole width less what it shows. */
const BAR = 15

const FIGURES: TableFitRule = { steps: ['one', 'two', 'least'], otherwise: 'two' }
const WORDS: TableFitRule = { steps: ['one'], otherwise: 'stack' }
/** The Analytics Model section's: its headings on two lines before its figures' words wrap. */
const WRAPS: TableFitRule = { steps: ['one', 'two'], otherwise: 'wrap' }

type Needs = Partial<Record<TableFit, number>>

/** Every step a box was laid out at, in order. */
let laidOut: string[] = []
/** The resize observers' reports, to call as a box changes size. */
let resized: (() => void)[] = []

/** The widths the layout gives: a frame's from its `data-width`, a table's by its box's step. */
function stubLayout() {
  const width = (element: HTMLElement, whole: boolean) => {
    if (element.classList.contains('chart-table-frame'))
      return Number(element.dataset.width) + (whole ? BAR : 0)
    if (element.tagName !== 'TABLE') return 0
    const at = element.closest<HTMLElement>('[data-fit]')?.dataset.fit as TableFit
    laidOut.push(at)
    return (JSON.parse(element.dataset.needs ?? '{}') as Needs)[at] ?? 0
  }
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return width(this, true)
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return width(this, false)
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly report: ResizeObserverCallback
      constructor(report: ResizeObserverCallback) {
        this.report = report
      }
      observe() {
        const report = () => this.report([], this as unknown as ResizeObserver)
        resized.push(report)
        report()
      }
      unobserve() {}
      disconnect() {}
    },
  )
}

/** A box of tables, one a frame, each taking `needs` at each step in a frame `frame` wide. */
function mountBox(rule: TableFitRule, tables: readonly Needs[], frame: number) {
  const holds = ref(0)
  const width = ref(frame)
  const Box = defineComponent({
    setup() {
      const box = ref<HTMLElement | null>(null)
      const fit = useTableFit(box, [holds], () => rule)
      return () =>
        h(
          'section',
          { 'ref': box, 'data-fit': fit.value },
          tables.map((needs) =>
            h('div', { 'class': 'chart-table-frame', 'data-width': width.value }, [
              h('table', { 'data-needs': JSON.stringify(needs) }),
            ]),
          ),
        )
    },
  })
  const wrapper = mount(Box, { attachTo: document.body })
  return { wrapper, holds, width, fit: () => (wrapper.element as HTMLElement).dataset.fit }
}

describe('how a table stands in its frame', () => {
  beforeEach(() => {
    laidOut = []
    resized = []
    stubLayout()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('stands at its first step whose columns fit, at whatever width the window is', async () => {
    const { fit } = mountBox(FIGURES, [{ one: 1074, two: 990, least: 881 }], 938)
    await nextTick()
    expect(fit()).toBe('least')
    // A frame as wide as the table at its first step keeps it there.
    const wide = mountBox(FIGURES, [{ one: 900, two: 880, least: 860 }], 900)
    await nextTick()
    expect(wide.fit()).toBe('one')
  })

  it("takes the page's answer where no step fits: scrolling at two, or stacked", async () => {
    const figures = mountBox(FIGURES, [{ one: 1300, two: 1100, least: 843 }], 688)
    const words = mountBox(WORDS, [{ one: 787 }], 708)
    await nextTick()
    expect(figures.fit()).toBe('two')
    expect(words.fit()).toBe('stack')
  })

  it('keeps every table of the box at one step, the first all of them fit at', async () => {
    const { fit } = mountBox(
      { steps: ['one', 'least'], otherwise: 'one' },
      [
        { one: 600, least: 600 },
        { one: 960, least: 690 },
      ],
      698,
    )
    await nextTick()
    expect(fit()).toBe('least')
  })

  it('lays a step out again only once what the table holds changes', async () => {
    const { holds, width, fit } = mountBox(FIGURES, [{ one: 1074, two: 990, least: 881 }], 938)
    await nextTick()
    expect(laidOut).toEqual(['one', 'two', 'least'])

    // Narrower, the steps known to run past even its whole width are not laid out again.
    laidOut = []
    width.value = 920
    await nextTick()
    for (const report of resized) report()
    expect(laidOut).toEqual(['least'])
    expect(fit()).toBe('least')

    // What it holds changed: every step is read again.
    laidOut = []
    holds.value += 1
    await nextTick()
    await nextTick()
    expect(laidOut).toEqual(['one', 'two', 'least'])
  })

  it("puts the headings on two lines before the page's cells wrap, and wraps them only past that", async () => {
    // 900 pixels with everything on one line, 800 with the headings on two, 700 wrapped as well.
    const needs = { one: 900, two: 800, wrap: 700 }
    const one = mountBox(WRAPS, [needs], 900)
    const two = mountBox(WRAPS, [needs], 850)
    await nextTick()
    expect([one.fit(), two.fit()]).toEqual(['one', 'two'])
    laidOut = []
    const wrapped = mountBox(WRAPS, [needs], 750)
    await nextTick()
    expect(wrapped.fit()).toBe('wrap')
    // The page's answer is what is left: it is never laid out.
    expect(laidOut).toEqual(['one', 'two'])
  })
})
