/**
 * A table's row names as drawn, which the specs of the tables that name values read: the lines a
 * name shows, what of it shows, its detail and the baselines of its row. Read off the letters'
 * line boxes, so a clamp, an ellipsis or a cut are seen as the reader sees them.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/**
 * A row's name as drawn: the lines its words show and their text, read from the line boxes of
 * each letter inside the box that holds them (the press, or the name's cell); the lines a detail
 * after it shows; and the baseline of the name's first line beside the baseline of each figure,
 * read from an empty box set before each one's first letter, whose bottom stands on the baseline.
 */
export function drawnName(row: Locator) {
  return row.evaluate((tr) => {
    const cells = [...tr.children] as HTMLElement[]
    const [name, ...figures] = cells
    if (!name) throw new Error('a row with no cells')
    const holder = name.querySelector<HTMLElement>('a, button') ?? name
    // This body is serialized and evaluated in the page, so a module-scope helper would not be in
    // scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const texts = (root: Element) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const found: Text[] = []
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node.textContent?.trim()) found.push(node as Text)
      return found
    }
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const inside = (rect: DOMRect, box: DOMRect) =>
      rect.top >= box.top - 1 &&
      rect.bottom <= box.bottom + 1 &&
      rect.left >= box.left - 1 &&
      rect.right <= box.right + 1
    /** The letters of `nodes` drawn inside `box`, and the lines they stand on. */
    const shownIn = (nodes: Text[], box: DOMRect) => {
      const range = document.createRange()
      const tops = new Set<number>()
      let shown = ''
      let top = Infinity
      for (const node of nodes)
        for (let at = 0; at < node.length; at += 1) {
          range.setStart(node, at)
          range.setEnd(node, at + 1)
          const rect = [...range.getClientRects()].find((one) => one.width > 0)
          if (!rect || !inside(rect, box)) continue
          tops.add(Math.round(rect.top))
          top = Math.min(top, rect.top)
          shown += node.data[at]
        }
      return { lines: tops.size, shown, top }
    }
    const baseline = (root: Element) => {
      const [first] = texts(root)
      if (!first?.parentNode) throw new Error('a cell with no text')
      const mark = document.createElement('span')
      mark.style.cssText = 'display:inline-block;inline-size:0;block-size:0'
      first.parentNode.insertBefore(mark, first)
      const at = mark.getBoundingClientRect().bottom
      mark.remove()
      return at
    }
    const nameBox = holder.getBoundingClientRect()
    const words = shownIn(texts(holder), nameBox)
    // What the cell says past its press: a session's detail.
    const after = texts(name).filter((node) => !holder.contains(node))
    const detail = after.length ? shownIn(after, name.getBoundingClientRect()) : null
    const edges = cells.map((cell) => cell.getBoundingClientRect())
    return {
      ...words,
      whole: holder.textContent ?? '',
      height: Math.round(nameBox.height * 100) / 100,
      nameBottom: Math.round(nameBox.bottom),
      detail,
      nameBaseline: baseline(holder),
      figureBaselines: figures.map((cell) => baseline(cell)),
      tops: edges.map((edge) => Math.round(edge.top * 100) / 100),
      bottoms: edges.map((edge) => Math.round(edge.bottom * 100) / 100),
    }
  })
}

export type Drawn = Awaited<ReturnType<typeof drawnName>>

/**
 * A text's letters without its spaces: a space a line breaks at is drawn with no width, and one
 * between two parts of a name stands outside both, so what is read off the screen has none.
 */
export const letters = (text: string) => text.replaceAll(/\s/gu, '')

/** Every figure on the name's first baseline, and every cell of the row as tall as the row. */
export function expectOneBaseline(drawn: Drawn, what: string) {
  expect(drawn.figureBaselines.length, `${what}: its figures`).toBeGreaterThan(0)
  for (const [index, at] of drawn.figureBaselines.entries())
    expect(
      Math.abs(at - drawn.nameBaseline),
      `${what}: figure ${index + 1} on the name's first line`,
    ).toBeLessThanOrEqual(1)
  expect(drawn.tops.length, `${what}: its cells`).toBeGreaterThan(1)
  for (const top of drawn.tops)
    expect(Math.abs(top - (drawn.tops[0] ?? 0)), `${what}: cell tops`).toBeLessThanOrEqual(1)
  for (const bottom of drawn.bottoms)
    expect(Math.abs(bottom - (drawn.bottoms[0] ?? 0)), `${what}: cell bottoms`).toBeLessThanOrEqual(
      1,
    )
}

/** The row of the table whose name holds `name`. */
export const rowNamed = (table: Locator, name: string) =>
  table
    .locator('tbody')
    .getByRole('row')
    .filter({ has: table.page().getByRole('rowheader', { name, exact: true }) })
