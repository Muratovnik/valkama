/**
 * Where a long title breaks. A browser offers no break after a `/`, so a run of
 * slash-joined words was one word to it, wider than a phone's line, and broke
 * wherever the line ran out: «un» on one line and «available» on the next. A
 * title breaks at a space, after a `/` or a hyphen, and inside a word only when
 * that one word is wider than its line.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { boardRoute, openList } from './boardPage.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

interface Break {
  before: string
  /** The words either side of the break, `|` where it falls. */
  near: string
}

/**
 * The characters either side of each place the text goes on to a new line, read from where
 * each character is drawn: a line starts again where a character stands lower than the last
 * one drawn. A space that ends a line hangs there with no width, so it is read as text but
 * not as a place. Titles here are in the Basic Multilingual Plane, so a character is one
 * UTF-16 offset.
 */
const breaksOf = (text: Locator) =>
  text.evaluate((element) => {
    const characters: { character: string; top: number | null }[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node
      Array.from(text.textContent ?? '', (character, at) => {
        range.setStart(text, at)
        range.setEnd(text, at + 1)
        const box = range.getClientRects()[0]
        characters.push({ character, top: box && box.width > 0 ? box.top : null })
        return character
      })
    }
    const words = (from: number, to: number) =>
      characters
        .slice(Math.max(from, 0), to)
        .map(({ character }) => character)
        .join('')
    let line: number | null = null
    return characters.flatMap(({ top }, at): Break[] => {
      if (top === null) return []
      const below = line !== null && top > line + 2
      line = top
      return below
        ? [
            {
              before: characters[at - 1].character,
              near: `${words(at - 8, at)}|${words(at, at + 8)}`,
            },
          ]
        : []
    })
  })

const NATURAL = new Set([' ', '/', '-'])

/**
 * Each break a title takes, as the words either side of it, and those of them that fall
 * anywhere but after a space, a slash or a hyphen.
 */
async function breaksIn(text: Locator) {
  await expect(text).toBeVisible()
  const breaks = await breaksOf(text)
  return {
    count: breaks.length,
    inside: breaks.filter(({ before }) => !NATURAL.has(before)).map(({ near }) => near),
  }
}

const openCard = async (page: Page) => {
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  return drawer
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
})

test('a long title breaks at a space or after a slash in the list at 390px', async ({ page }) => {
  await installBackend(page)
  await openList(page)
  const row = page.locator('.work-item-list tbody tr').filter({ hasText: workItemRef.reference })
  const { count, inside } = await breaksIn(row.locator('.list-name'))
  // The title has to be too long for its line here, or nothing was tested.
  expect(count).toBeGreaterThan(0)
  expect(inside, 'breaks inside a word').toEqual([])
})

test('a long title breaks at a space or after a slash on the board at 390px', async ({ page }) => {
  await installBackend(page)
  await page.goto(boardRoute())
  const tile = page.locator(`.work-item-board [data-reference="${workItemRef.reference}"]`)
  const { count, inside } = await breaksIn(tile.locator('.tile-title'))
  // The title has to be too long for its line here, or nothing was tested.
  expect(count).toBeGreaterThan(0)
  expect(inside, 'breaks inside a word').toEqual([])
})

test("a long title breaks at a space or after a slash at a card's head at 390px", async ({
  page,
}) => {
  await installBackend(page)
  const drawer = await openCard(page)
  const { count, inside } = await breaksIn(drawer.locator('.drawer-frame-name'))
  // The title has to be too long for its line here, or nothing was tested.
  expect(count).toBeGreaterThan(0)
  expect(inside, 'breaks inside a word').toEqual([])
})

test('a word wider than its line still breaks inside, and nothing is pushed past the edge', async ({
  page,
}) => {
  const word = 'Supercalifragilisticexpialidociousandthensomemoreofit'
  await installBackend(page, { card: (read) => ({ ...read, title: `${word}/${word}` }) })
  const drawer = await openCard(page)
  const name = drawer.locator('.drawer-frame-name')
  await expect(name).toHaveText(`${word}/${word}`)
  const breaks = await breaksOf(name)
  // After the slash, and inside each word as well, since neither fits a line.
  expect(breaks.map(({ before }) => before)).toContain('/')
  expect(breaks.some(({ before }) => before !== '/')).toBe(true)
  const overflow = await name.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow, 'the title stays inside its box').toBeLessThanOrEqual(0)
})
