/**
 * Where a long title breaks. A browser offers no break after a `/`, so a run of
 * slash-joined words was one word to it, wider than a phone's line, and broke
 * wherever the line ran out: «un» on one line and «available» on the next. A
 * title breaks at a space, after a `/` or a hyphen, and inside a word only when
 * that one word is wider than its line.
 *
 * A place to break is not text: the title's text, a selection's copy and the
 * accessible name of what the title names stay the title as written. A `<wbr>`
 * after each `/` broke the lines right, and Chromium named the element with a
 * space at each one: «loading/ empty/ error/ unavailable».
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { boardRoute, openList } from './boardPage.ts'
import { projectId, projectScope, spaceRef, workItem, workItemRef } from './planningFixtures.ts'
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

/**
 * The accessible name Chromium gives an element, read from its accessibility tree through
 * CDP: what a screen reader announces, which neither `textContent` nor a locator's
 * accessible-name matcher reports, since both are computed apart from the browser's tree.
 */
async function accessibleName(page: Page, element: Locator) {
  const cdp = await page.context().newCDPSession(page)
  await element.evaluate((node) => {
    node.dataset.named = ''
  })
  try {
    await cdp.send('Accessibility.enable')
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '[data-named]',
    })
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
      nodeId,
      fetchRelatives: false,
    })
    return String(nodes[0]?.name?.value ?? '')
  } finally {
    await element.evaluate((node) => {
      delete node.dataset.named
    })
    await cdp.detach()
  }
}

/** What a selection of the whole text holds, which is what a copy of it takes. */
const copyOf = (text: Locator) =>
  text.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const copied = selection?.toString() ?? ''
    selection?.removeAllRanges()
    return copied
  })

/**
 * The name of what a title is drawn in, once its text and a selection's copy were found to be
 * the title as written, and the name to hold the title as written too.
 */
async function nameOf(page: Page, { named, text }: { named: Locator; text: Locator }) {
  const title = workItem.title
  await expect(text).toHaveText(title)
  expect(await text.evaluate((element) => element.textContent)).toBe(title)
  expect(await copyOf(text), 'what a copy takes').toBe(title)
  const name = await accessibleName(page, named)
  expect(name, 'the name holds the title as written').toContain(title)
  return name
}

/**
 * The name the same element has with its title as plain text, no place to break in it: what
 * a name made of the title and more, a list cell's or a link's, should be. The title is no
 * longer drawn by the application after it, so it ends a test.
 */
async function plainNameOf(page: Page, { named, text }: { named: Locator; text: Locator }) {
  await text.evaluate((element, plain) => element.replaceChildren(plain), workItem.title)
  return accessibleName(page, named)
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

test('a title is read, copied and named as written in the list', async ({ page }) => {
  await installBackend(page)
  await openList(page)
  const row = page.locator('.work-item-list tbody tr').filter({ hasText: workItemRef.reference })
  const drawn = { named: row.locator('td.list-title'), text: row.locator('.list-name') }
  const name = await nameOf(page, drawn)
  expect(name).toBe(await plainNameOf(page, drawn))
})

test('a title is read, copied and named as written on the board', async ({ page }) => {
  await installBackend(page)
  await page.goto(boardRoute())
  const tile = page.locator(`.work-item-board [data-reference="${workItemRef.reference}"]`)
  const name = await nameOf(page, {
    named: tile.locator('.tile-open'),
    text: tile.locator('.tile-title'),
  })
  expect(name).toBe(`${workItemRef.reference} ${workItem.title}`)
})

test("a title is read, copied and named as written at a card's head", async ({ page }) => {
  await installBackend(page)
  const drawer = await openCard(page)
  const heading = drawer.locator('.drawer-frame-name')
  expect(await nameOf(page, { named: heading, text: heading })).toBe(workItem.title)
})

test("a linked item's title breaks after a slash and is named as written among a card's links", async ({
  page,
}) => {
  await installBackend(page, {
    card: (read) => ({
      ...read,
      links: workItem.links.map((link) => ({
        ...link,
        title: workItem.title,
        state_category: 'backlog',
        state_name: 'Backlog',
        is_terminal: false,
        state_unavailable: null,
      })),
    }),
  })
  const drawer = await openCard(page)
  await drawer.getByRole('tab', { name: /Relations/iu }).click()
  const link = drawer.locator('.link-open').first()
  const text = link.locator('.link-title')
  const { count, inside } = await breaksIn(text)
  expect(count).toBeGreaterThan(0)
  expect(inside, 'breaks inside a word').toEqual([])
  const name = await nameOf(page, { named: link, text })
  expect(name).toBe(await plainNameOf(page, { named: link, text }))
})

test("a found item's title breaks after a slash and is named as written in the finder", async ({
  page,
}) => {
  await installBackend(page)
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: 'main',
        limit: 50,
        has_more: false,
        items: [
          {
            target: {
              project_id: projectId,
              space_ref: spaceRef,
              reference: workItem.reference,
              writable: true,
            },
            item: {
              work_item_id: workItem.work_item_id,
              planning_space_id: workItem.planning_space_id,
              reference: workItem.reference,
              title: workItem.title,
              state: { name: 'Dev' },
              claim_ref: '',
            },
          },
        ],
        coverage: [
          { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
        ],
      },
    }),
  )
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningSpaceEntity(spaceRef),
    }),
  )
  await expect(page.locator('.work-item-board')).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Find a task', exact: true })
  await dialog.getByRole('combobox').fill('main')
  const option = dialog.getByRole('option')
  await expect(option).toHaveCount(1)
  const text = option.locator('.command-title')
  const { count, inside } = await breaksIn(text)
  expect(count).toBeGreaterThan(0)
  expect(inside, 'breaks inside a word').toEqual([])
  const name = await nameOf(page, { named: option, text })
  expect(name).toBe(await plainNameOf(page, { named: option, text }))
})

test("a candidate's title breaks after a slash and is named as written in the picker of related work", async ({
  page,
}) => {
  await installBackend(page)
  await page.route('**/api/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-api',
        work_items: [
          {
            work_item_id: '00000000-0000-4000-8000-000000000107',
            planning_space_id: workItem.planning_space_id,
            reference: 'MAIN-7',
            title: workItem.title,
            state: { name: 'Doing' },
            claim_ref: '',
          },
        ],
      },
    }),
  )
  const drawer = await openCard(page)
  await drawer.getByRole('tab', { name: /Relations/iu }).click()
  await drawer.getByRole('button', { name: 'Add link', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Related task', exact: true })
  await dialog.getByLabel('Reference, number or title').fill('loading')
  const radio = dialog.getByRole('radio')
  await expect(radio).toHaveCount(1)
  const text = dialog.locator('.result-title > span')
  const { count, inside } = await breaksIn(text)
  expect(count).toBeGreaterThan(0)
  expect(inside, 'breaks inside a word').toEqual([])
  const name = await nameOf(page, { named: radio, text })
  expect(name).toBe(await plainNameOf(page, { named: radio, text }))
})
