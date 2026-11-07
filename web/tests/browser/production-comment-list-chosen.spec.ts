/**
 * What is ticked and folded under a list's rows, read off the built page at a desktop width and
 * a phone's: it stands whole under the rows (`RequestChosen`), and in a list, whose rows have no
 * ground and no inset, it keeps to the rows' two edges, the boxes' and the words', and adds no
 * third. In a question it keeps to its rows as it did: its ground on theirs, its words on the
 * radios'.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { boxes, openList } from './commentListBackend.ts'
import { frames } from './frames.ts'
import { asked, mixedField, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

const FOLDED = 'Rewrite the reader'

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await frames(page.locator(':root'))
}

/** The left edge of the first line of words drawn in an element, through a Range. */
const wordsLeft = (scope: Locator) =>
  scope.evaluate((node) => {
    const text = document
      .createTreeWalker(node, NodeFilter.SHOW_TEXT, {
        acceptNode: (found) =>
          found.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      })
      .nextNode()
    if (!text) throw new Error('Nothing written here')
    const range = document.createRange()
    range.selectNodeContents(text)
    return [...range.getClientRects()].find((rect) => rect.width > 0)?.left ?? Number.NaN
  })

/** A block's ground, if it draws one: its left edge, or null. */
const groundOf = (scope: Locator) =>
  scope.evaluate((node) => {
    const fill = getComputedStyle(node).backgroundColor
    const bare = fill === 'transparent' || /rgba\(.*,\s*0\)$/u.test(fill)
    return bare ? null : node.getBoundingClientRect().left
  })

const leftOf = async (scope: Locator) => {
  const bounds = await scope.boundingBox()
  return bounds?.x ?? Number.NaN
}
const near = (one: number, other: number) => Math.abs(one - other) <= 1

/** The edges drawn in the list's column: the boxes', the rows' words', and the block's. */
async function listEdges(page: Page, list: Locator) {
  await settle(page)
  const chosen = list.locator('.request-chosen')
  return {
    box: await leftOf(boxes(list).first()),
    words: await wordsLeft(list.locator('.request-option-words').first()),
    texts: [
      await wordsLeft(chosen.locator('.request-chosen-label')),
      await wordsLeft(chosen.locator('.request-chosen-text')),
    ],
    ground: await groundOf(chosen),
  }
}

/** The block's words on the boxes' edge or the words', a ground only on the boxes', and two
 *  edges in the column in all. */
function expectTwoEdges({ box, words, texts, ground }: Awaited<ReturnType<typeof listEdges>>) {
  for (const [index, text] of texts.entries())
    expect(
      near(text, box) || near(text, words),
      `the block's words ${index + 1} at ${text} on the boxes' ${box} or the words' ${words}`,
    ).toBe(true)
  expect(near(ground ?? box, box), `a ground at ${ground} drawn on the boxes' edge`).toBe(true)
  const drawn = [box, words, ...texts, ground ?? box]
  const distinct = drawn.filter(
    (edge, index) => drawn.findIndex((other) => near(other, edge)) === index,
  )
  expect(distinct, "two left edges in the list's column").toHaveLength(2)
}

for (const width of [1280, 390]) {
  test(`a ticked, folded mark stands whole under the rows on their two edges at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { list } = await openList(page)
    await list.getByRole('checkbox', { name: FOLDED }).check()
    const chosen = list.locator('.request-chosen')
    await expect(chosen).toContainText('Paragraph 6')
    expectTwoEdges(await listEdges(page, list))
    // Changing what was sent, the block stands again, on the same edges.
    await list.getByRole('button', { name: 'Send marks', exact: true }).click()
    await list.getByRole('button', { name: 'Change', exact: true }).click()
    await expect(chosen).toContainText('Paragraph 6')
    expectTwoEdges(await listEdges(page, list))
  })

  test(`a question's chosen block keeps its ground on its rows' and its words on the radios' at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1200 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { card } = await openQuestion(page, [asked({ fields: [mixedField] })])
    const radio = card.getByRole('radio', { name: 'With a text', exact: true })
    await radio.check()
    const chosen = card.locator('.request-chosen')
    await expect(chosen).toContainText('second paragraph')
    await settle(page)
    const row = await leftOf(card.locator('.request-option').first())
    const control = await leftOf(radio)
    expect(near((await groundOf(chosen)) ?? Number.NaN, row), 'its ground on the rows').toBe(true)
    expect(near(await wordsLeft(chosen.locator('.request-chosen-label')), control)).toBe(true)
    expect(near(await wordsLeft(chosen.locator('.request-chosen-text')), control)).toBe(true)
  })
}
