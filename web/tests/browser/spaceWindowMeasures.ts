/**
 * What the space window's spec reads off the page by the window's hooks: the open dialog's
 * bounds and rows, the words a control is described by, every row's folder and its last folder,
 * whether an element stands where the reader sees it, and, on the page under it, the line of
 * projects in no space and each card's gear.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

import { record } from './analyticsPage.ts'

/** How far apart the farthest of these edges are. */
const spread = (edges: number[]) => (edges.length ? Math.max(...edges) - Math.min(...edges) : 0)

/** The open dialog stays inside the window, and nothing in it runs past its own width. */
export async function measureDialog(page: Page, info: TestInfo, tag: string, width: number) {
  const box = await page.getByRole('dialog').evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect()
    const body = dialog.querySelector('.dialog-frame-body')
    const names = [...dialog.querySelectorAll('[data-part="name"]')].map((name) => ({
      text: name.textContent.trim(),
      cut: name.scrollWidth - name.clientWidth,
    }))
    return {
      left: rect.left,
      right: rect.right,
      sideways: body ? body.scrollWidth - body.clientWidth : Number.NaN,
      names,
      rows: [...dialog.querySelectorAll('[data-project]')].map((row) => {
        const edge = (part: string) =>
          row.querySelector(`[data-part="${part}"]`)?.getBoundingClientRect()
        const name = row.querySelector('[data-part="name"]')
        const line = document.createRange()
        if (name?.firstChild) line.setStart(name.firstChild, 0)
        if (name?.firstChild) line.setEnd(name.firstChild, 1)
        const first = line.getBoundingClientRect()
        const radio = edge('default')
        return {
          name: edge('name')?.left ?? Number.NaN,
          root: edge('root')?.left ?? Number.NaN,
          radioOffLine: radio
            ? Math.abs(radio.top + radio.height / 2 - (first.top + first.height / 2))
            : 0,
          removeOver: (edge('remove')?.height ?? 0) - row.getBoundingClientRect().height,
        }
      }),
    }
  })
  expect(box.left, JSON.stringify(box)).toBeGreaterThanOrEqual(0)
  expect(box.right, JSON.stringify(box)).toBeLessThanOrEqual(width)
  expect(box.sideways, JSON.stringify(box)).toBeLessThanOrEqual(0)
  expect(box.names.filter((name) => name.cut > 0.5)).toEqual([])
  // The rows' names and folders each start at one edge, the radio sits on the name's first
  // line and the remove is no taller than its row.
  expect(spread(box.rows.map((row) => row.name)), JSON.stringify(box.rows)).toBeLessThanOrEqual(1)
  expect(spread(box.rows.map((row) => row.root)), JSON.stringify(box.rows)).toBeLessThanOrEqual(1)
  for (const row of box.rows) {
    expect(row.radioOffLine, JSON.stringify(row)).toBeLessThanOrEqual(1)
    expect(row.removeOver, JSON.stringify(row)).toBeLessThanOrEqual(0)
  }
  await page.screenshot({
    path: info.outputPath(`space-window-${tag}.png`),
    animations: 'disabled',
  })
  await record(info, `space window ${tag}`, box)
}

/** The words a control is described by, as its `aria-describedby` names them. */
export const describedText = (control: Locator) =>
  control.evaluate((element) =>
    (element.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => (id ? (document.querySelector(`#${CSS.escape(id)}`)?.textContent ?? '') : ''))
      .join(' '),
  )

/**
 * Every row's folder and its last folder, read by their hooks: the folder's box, and whether
 * its last folder shows whole inside it, the part that tells one project from the next.
 */
export function measureFolders(dialog: Locator) {
  return dialog.locator('[data-project]').evaluateAll((rows) =>
    rows.map((row) => {
      const root = row.querySelector('[data-part="root"]')
      const tail = row.querySelector<HTMLElement>('[data-part="root-tail"]')
      const box = root?.getBoundingClientRect()
      const tailBox = tail?.getBoundingClientRect()
      return {
        name: row.querySelector('[data-part="name"]')?.textContent.trim() ?? '',
        width: box?.width ?? 0,
        tail: tail?.textContent ?? '',
        tailWidth: tailBox?.width ?? 0,
        tailCut: tail ? tail.scrollWidth - tail.clientWidth : Number.NaN,
        tailPast: box && tailBox ? tailBox.right - box.right : Number.NaN,
      }
    }),
  )
}

/**
 * The line of projects in no space, read off the page: on how many lines each of `names` lies,
 * the words a reader sees, and how far the line stands from the cards above it beside the gap
 * the page keeps between its head and those cards. With no card, both gaps are absent.
 */
export const measureUnplaced = (page: Page, names: readonly string[]) =>
  page.locator('[data-part="unplaced"]').evaluate((strip: HTMLElement, wanted) => {
    const texts: Text[] = []
    const walker = document.createTreeWalker(strip, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)
    const linesOf = (name: string) => {
      const node = texts.find((text) => text.data.includes(name))
      if (!node) return 0
      const range = document.createRange()
      range.setStart(node, node.data.indexOf(name))
      range.setEnd(node, node.data.indexOf(name) + name.length)
      return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size
    }
    const grid = document.querySelector('article')?.parentElement
    const head = grid?.previousElementSibling
    const [gridBox, headBox] = [grid?.getBoundingClientRect(), head?.getBoundingClientRect()]
    return {
      lines: Object.fromEntries(wanted.map((name) => [name, linesOf(name)])),
      // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- the words as laid out: a space a line drops is in `textContent` still
      seen: strip.innerText,
      fromCards: gridBox ? strip.getBoundingClientRect().top - gridBox.bottom : Number.NaN,
      pageGap: gridBox && headBox ? gridBox.top - headBox.bottom : Number.NaN,
    }
  }, names)

/** How far each card's «Configure space» glyph stands from the start of the card's title. */
export const gearOffsets = (page: Page) =>
  page.locator('[data-part="configure"]').evaluateAll((gears) =>
    gears.map((gear) => {
      const title = gear.closest('article')?.querySelector('header')?.getBoundingClientRect()
      const glyph = gear.querySelector('svg')?.getBoundingClientRect()
      return title && glyph ? glyph.left - title.left : Number.NaN
    }),
  )

/**
 * Whether the element stands where the reader sees it: inside the window, and the topmost
 * thing at its middle, so no scroller has carried it out of its view and nothing covers it.
 */
export const inView = (element: Locator) =>
  element.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const [x, y] = [box.left + box.width / 2, box.top + box.height / 2]
    const hit = y < innerHeight && y > 0 ? document.elementFromPoint(x, y) : null
    return { top: box.top, bottom: box.bottom, height: innerHeight, seen: node.contains(hit) }
  })
