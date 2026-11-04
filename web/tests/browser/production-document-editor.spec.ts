import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { aCardAsking, LINK, linkIn } from './documentBackend.ts'
import { openBesideCard, paneOf, settled, shot } from './documentBeside.ts'
import {
  answerFilePlans,
  copiedIn,
  EDITOR,
  fileAsked,
  keepCopies,
  noticeOf,
  openedIn,
  ringRoom,
} from './documentEditorPlan.ts'
import { openPage } from './documentPageSurface.ts'
import { test } from './test.ts'

/**
 * The viewer's head opens the document's own file in the editor, at the line the reader is
 * at, in each place the viewer stands: over a card, beside it, and on its own page. The
 * plan is answered as the server answers a browser, and the page follows its link.
 *
 * The lines are the fixtures' own, counted from their text: in the card's plan the anchor
 * `kb:a7f3` heads line 85 and the title line 7; in the page's plan «Paragraph 5 of the
 * second part.» is line 32 and the title line 6.
 */

const drawerOf = (page: Page) => page.locator('.document-drawer')

/** Brings the text back to its start, as the reader would with Home. */
const toStart = (body: Locator) =>
  body.evaluate((node) => {
    node.scrollTop = 0
  })

test.describe('over a card', () => {
  test('by keyboard from the head, and the file opens at the anchor', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    const asked = await answerFilePlans(page)
    await linkIn(drawer, LINK).focus()
    await page.keyboard.press('Enter')
    const viewer = drawerOf(page)
    await settled(viewer)
    const target = viewer.locator('.document-block.is-target')
    await expect(target).toBeFocused()
    // Room for the ring at each side, as there is above it.
    expect(await ringRoom(target)).toEqual({ start: 8, end: 20 })
    await shot(page, 'drawer-1100-en')

    // Refresh holds no place of its own to lose; the walk to it is the keyboard spec's.
    const editor = viewer.getByRole('button', { name: EDITOR, exact: true })
    await viewer.getByRole('button', { name: 'Refresh' }).focus()
    await page.keyboard.press('Tab')
    await expect(editor).toBeFocused()
    await expect(editor).toHaveAttribute(
      'title',
      'Open this file in VS Code at the line you are reading',
    )
    await page.keyboard.press('Enter')

    await expect(noticeOf(page)).toHaveText('Opened in VS Code')
    expect(fileAsked(asked.at(-1))).toEqual({
      target: 'file',
      project: 'demo',
      path: 'docs/plan.md',
      line: '85',
      surface: 'browser',
    })
    expect(await openedIn(page)).toEqual(['vscode://file/C:/work/demo/docs/plan.md:85:1'])
    // The press answers in the shell and leaves the reader where they were.
    await expect(editor).toBeFocused()
    await expect(viewer).toBeVisible()
  })

  test('on a phone the ring has room at the drawer’s edge, and the head keeps its words', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    await linkIn(drawer, LINK).focus()
    await page.keyboard.press('Enter')
    const viewer = drawerOf(page)
    await settled(viewer)
    const target = viewer.locator('.document-block.is-target')
    await expect(target).toBeFocused()
    expect(await ringRoom(target)).toEqual({ start: 8, end: 16 })
    // The title and its path keep the first row whole; the actions take the next.
    const editor = viewer.getByRole('button', { name: EDITOR, exact: true })
    await expect(editor).toBeInViewport()
    const title = viewer.locator('.overlay-header-name')
    const path = viewer.locator('.document-path')
    for (const words of [title, path])
      expect(await words.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0)
    const titleBox = await title.boundingBox()
    const pathBox = await path.boundingBox()
    const editorBox = await editor.boundingBox()
    expect(editorBox?.y).toBeGreaterThanOrEqual((pathBox?.y ?? 0) + (pathBox?.height ?? 0))
    expect(titleBox?.width).toBeGreaterThan(250)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await shot(page, 'drawer-390-en')
  })
})

test('beside a card: the top block’s line once the reader has moved, and a refusal copies', async ({
  page,
}) => {
  await keepCopies(page)
  const { drawer } = await openBesideCard(page)
  await linkIn(drawer, LINK).focus()
  await page.keyboard.press('Enter')
  const { pane, body, target } = paneOf(page)
  await expect(target).toBeFocused()
  await settled(drawer)
  expect(await ringRoom(target)).toEqual({ start: 8, end: 16 })
  await shot(page, 'beside-1500-en')

  const asked = await answerFilePlans(page)
  await toStart(body)
  const editor = pane.getByRole('button', { name: EDITOR, exact: true })
  await editor.click()
  await expect(noticeOf(page)).toHaveText('Opened in VS Code')
  expect(fileAsked(asked.at(-1)).line).toBe('7')

  await page.unroute('**/api/open-plan*')
  await answerFilePlans(page, true)
  await editor.click()
  await expect(noticeOf(page)).toHaveText('Nothing is there. The path was copied')
  expect(await copiedIn(page)).toEqual(['docs/plan.md'])
  // A refusal opens nothing, and the document stays beside the card.
  expect(await openedIn(page)).toHaveLength(1)
  await expect(pane).toBeVisible()
})

test('on its own page: at the line the address names, and by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openPage(page, 'docs/plan.md', '#L32')
  const asked = await answerFilePlans(page)
  const body = page.locator('.document-body')
  await expect(page.locator('.document-block.is-target')).toBeInViewport()
  await expect(body).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  const editor = page.getByRole('button', { name: EDITOR, exact: true })
  await expect(editor).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(noticeOf(page)).toHaveText('Opened in VS Code')
  expect(fileAsked(asked.at(-1))).toEqual({
    target: 'file',
    project: 'demo',
    path: 'docs/plan.md',
    line: '32',
    surface: 'browser',
  })
  await shot(page, 'doc-1280-en')

  // The reader moves on to a heading, and the line named is no longer on screen. The block
  // before the heading starts above the edge and ends above it too.
  await body.evaluate((node) => {
    const heading = [...node.querySelectorAll<HTMLElement>('.document-block')].find(
      (block) => block.textContent?.trim() === 'The target',
    )
    heading?.scrollIntoView({ block: 'start' })
  })
  await page.keyboard.press('Enter')
  await expect.poll(() => asked.length).toBe(2)
  expect(fileAsked(asked.at(-1)).line).toBe('84')

  await toStart(body)
  await page.keyboard.press('Enter')
  await expect.poll(() => asked.length).toBe(3)
  expect(fileAsked(asked.at(-1)).line).toBe('32')
})

/** How many pixels of a picture differ from its first one, read on a blank page. */
async function inked(page: Page, png: Buffer) {
  const blank = await page.context().newPage()
  const count = await blank.evaluate(async (data) => {
    const picture = new Image()
    picture.src = `data:image/png;base64,${data}`
    await picture.decode()
    const surface = new OffscreenCanvas(picture.width, picture.height)
    const paint = surface.getContext('2d')
    paint?.drawImage(picture, 0, 0)
    const pixels = paint?.getImageData(0, 0, picture.width, picture.height).data ?? []
    let apart = 0
    for (let at = 0; at < pixels.length; at += 4) {
      const channels = [0, 1, 2].map((channel) =>
        Math.abs((pixels[at + channel] ?? 0) - (pixels[channel] ?? 0)),
      )
      if (Math.max(...channels) >= 48) apart += 1
    }
    return apart
  }, png.toString('base64'))
  await blank.close()
  return count
}

test.describe('in a forced palette', () => {
  test.use({ forcedColors: 'active' })

  test('the button’s glyph and its focus ring are drawn in the palette’s colours', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    await linkIn(drawer, LINK).click()
    const viewer = drawerOf(page)
    await settled(viewer)
    const editor = viewer.getByRole('button', { name: EDITOR, exact: true })
    const box = (await editor.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
    const clip = { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 }
    const resting = await inked(page, await page.screenshot({ clip }))
    // A 20 px glyph drawn in the palette's text colour, and nothing over its edge.
    expect(resting).toBeGreaterThan(40)

    await viewer.getByRole('button', { name: 'Refresh' }).focus()
    await page.keyboard.press('Tab')
    await expect(editor).toBeFocused()
    const ringed = await inked(page, await page.screenshot({ clip }))
    // A 2 px ring all round a 44 px box: about two hundred pixels more.
    expect(ringed - resting).toBeGreaterThan(150)
    await shot(page, 'drawer-1100-forced')
  })
})
