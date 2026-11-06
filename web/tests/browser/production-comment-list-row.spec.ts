/**
 * The row of controls under a list an agent put under its comment, held to the rules of a
 * question's row (`requestRow.ts`) in each of the list's four states, in both languages, at a
 * desktop width and a phone's: waiting (and after a send that failed), answered, changing with
 * the asking before a change is dropped, and frozen by a closed task.
 *
 * The list declines nothing, so no place is kept for an asking: every line of the row holds a
 * control. Sent or frozen it is a record, whose one line ends with the way to change it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { boxes, listEntry, moveItem, openList } from './commentListBackend.ts'
import { expectStripOnColumn } from './confirmStrip.ts'
import { centre, expectRow, near } from './requestRow.ts'
import { test } from './test.ts'

const LOCALES = ['en', 'ru'] as const
const WIDTHS = [1280, 390] as const
type Locale = (typeof LOCALES)[number]
const GAP = 8

async function inLocale(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

/** Every control of the row on one line: the comment's glyph with the way on, or with the pair. */
async function expectOneLine(row: Locator, what: string) {
  const { members } = await expectRow(row, what, { declinable: false })
  const [first, ...rest] = members.map((member) => centre(member))
  for (const other of rest)
    expect(near(other, first ?? other), `${what}: the glyph on the line of the buttons`).toBe(true)
}

/**
 * The record's line as drawn: its words by a Range, the way to change it by its box, against
 * the list's own edges.
 */
const recordLine = (list: Locator) =>
  list.evaluate((node) => {
    const line = node.querySelector('.comment-list-outcome')
    const words = line?.querySelector('.comment-list-state')
    const text = words && document.createTreeWalker(words, NodeFilter.SHOW_TEXT).nextNode()
    if (!line || !text) throw new Error('The record has no line')
    const range = document.createRange()
    range.selectNodeContents(text)
    const lines = [...range.getClientRects()].filter((rect) => rect.width > 0)
    const change = line.querySelector('.comment-list-change')?.getBoundingClientRect() ?? null
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const edge = (rect: DOMRect) => ({
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top,
    })
    return {
      change: change && edge(change),
      lines: lines.map((rect) => edge(rect)),
      list: edge(node.getBoundingClientRect()),
      row: edge(line.getBoundingClientRect()),
    }
  })

/** The words start on the list's edge, the way to change them ends it, and nothing else is a
 *  line of the row: its top and bottom are theirs. */
async function expectRecord(list: Locator, what: string, changeable: boolean) {
  await expect(list.locator('.request-actions')).toHaveCount(0)
  const { change, lines, list: edges, row } = await recordLine(list)
  const [first] = lines
  expect(first, `${what}: the record's words are drawn`).toBeDefined()
  expect(near(first?.left ?? Number.NaN, edges.left), `${what}: words on the list's edge`).toBe(
    true,
  )
  expect(change !== null, `${what}: the way to change it`).toBe(changeable)
  const drawn = [...lines, ...(change ? [change] : [])]
  expect(near(row.top, Math.min(...drawn.map((box) => box.top))), `${what}: row starts`).toBe(true)
  expect(near(row.bottom, Math.max(...drawn.map((box) => box.bottom))), `${what}: row ends`).toBe(
    true,
  )
  if (!change) return
  expect(near(change.right, edges.right), `${what}: Change ends the row`).toBe(true)
  const wordsWidth = lines.reduce((sum, line) => sum + line.right - line.left, 0)
  if (wordsWidth + GAP + change.right - change.left <= edges.right - edges.left)
    expect(
      near(centre(change), centre(first ?? change)),
      `${what}: Change on the line of the words, as both fit`,
    ).toBe(true)
}

for (const locale of LOCALES)
  for (const width of WIDTHS) {
    const at = `${locale} at ${width}`

    test(`${at}: the list's row in every state keeps the rules of a question's row`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const opened = await openList(page, [listEntry()])
      const { list, requests } = opened
      const row = list.locator('.request-actions')

      // Waiting: the comment's glyph and the way on, nothing declined.
      await expect(list.locator('.request-onward')).toBeVisible()
      await expect(list.locator('.request-way-out')).toHaveCount(0)
      await expectOneLine(row, `${at} waiting`)

      // A send that failed adds Check status before the way on, at the row's start.
      await boxes(list).first().check()
      requests.failNext(503)
      await list.locator('.request-onward').click()
      await expect(list.locator('.request-error')).toBeVisible()
      await expectRow(row, `${at} after a failed send`, { declinable: false })
      await list.locator('.request-lead-controls button').click()
      await expect(list.locator('.request-error')).toHaveCount(0)

      // Answered.
      await list.locator('.request-onward').click()
      await expect(boxes(list)).toHaveCount(0)
      await expectRecord(list, `${at} answered`, true)

      // Changing: Cancel and Save with the glyph on one line, and the asking before a change
      // is dropped on the comment's sheet, its words on the list's edge.
      await list.locator('.comment-list-change').click()
      await expect(list.locator('.request-way-out')).toBeVisible()
      await expectOneLine(row, `${at} changing`)
      await boxes(list).nth(1).check()
      await expectOneLine(row, `${at} changing, something changed`)
      await list.locator('.request-way-out').click()
      const strip = list.locator('.confirm-strip')
      await expectStripOnColumn(strip, list, `${at} asking`)
      await strip.locator('button').first().click()
      await expect(strip).toHaveCount(0)
      await list.locator('.request-onward').click()
      await expect(boxes(list)).toHaveCount(0)

      // Frozen: a record with nothing to press.
      await moveItem(opened, true)
      await expect(list.locator('.comment-list-change')).toHaveCount(0)
      await expectRecord(list, `${at} frozen`, false)
    })
  }
