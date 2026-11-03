/**
 * The hover card and the keyboard: a Tab shows it and takes it away, Escape closes
 * only it, focus an overlay gives back does not bring it up, and a surface opening
 * over it closes it. What a screen reader is told is read from the browser's own
 * accessibility tree.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import {
  card,
  CARD,
  cardsAfterTheDelay,
  coolDown,
  HUB_PROMPT,
  middle,
  openHub,
  openReported,
  pause,
  reference,
  rest,
} from './previewPage.ts'
import { test } from './test.ts'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
})

/** The button's description in the accessibility tree, as the browser computed it. */
async function described(page: Page, link: Locator) {
  const session = await page.context().newCDPSession(page)
  const marked = 'data-ax-probe'
  await link.evaluate((element, name) => element.setAttribute(name, ''), marked)
  const { root } = await session.send('DOM.getDocument')
  const { nodeId } = await session.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: `[${marked}]`,
  })
  const { nodes } = await session.send('Accessibility.getPartialAXTree', {
    nodeId,
    fetchRelatives: false,
  })
  await link.evaluate((element, name) => element.removeAttribute(name), marked)
  await session.detach()
  const [node] = nodes
  return { name: node?.name?.value as string, description: node?.description?.value as string }
}

/** Tab until the reference holds focus. */
async function tabTo(page: Page, link: Locator) {
  for (let press = 0; press < 80; press += 1) {
    await page.keyboard.press('Tab')
    if (await link.evaluate((element) => element === document.activeElement)) return
  }
  throw new Error('Tab never reached the reference')
}

test('a Tab shows the card at once and describes the reference; leaving takes it away', async ({
  page,
}) => {
  const { drawer, entry } = await openReported(page)
  const link = reference(entry, 'MAIN-12')
  expect(await described(page, link)).toEqual({
    name: 'MAIN-12',
    description: 'Open task MAIN-12',
  })

  // Reached from just before it, so this Tab is the one that lands.
  await link.evaluate((element) => {
    const before = document.createElement('button')
    before.dataset.before = ''
    element.before(before)
  })
  await entry.locator('[data-before]').focus()
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
  const shown = card(page)
  // No wait: the description has to be there as focus lands.
  await expect(shown).toBeVisible({ timeout: 300 })
  await expect(shown).toHaveAttribute('data-state', 'instant-open')

  const opened = await described(page, link)
  expect(opened.name).toBe('MAIN-12')
  expect(opened.description).toContain('Keep the reader in place when a card closes')
  expect(opened.description).toContain('Steps: 1 of 3')
  await expect(link).toHaveAttribute('aria-describedby', /.+/u)

  // On to the next reference, whose card it becomes.
  await page.keyboard.press('Tab')
  await expect(shown).toContainText('MAIN-13')
  await expect(link).not.toHaveAttribute('aria-describedby')
  const gone = await described(page, link)
  expect(gone.description).toBe('Open task MAIN-12')
  const next = await described(page, reference(entry, 'MAIN-13'))
  expect(next.description).toContain('Waits for the contract')

  // And away from references altogether.
  await drawer.locator('.discussion-form').getByRole('textbox').focus()
  await expect(shown).toHaveCount(0)
  await expect(reference(entry, 'MAIN-13')).not.toHaveAttribute('aria-describedby')
})

test('a Tab that scrolls the reference into view keeps the card it opens', async ({ page }) => {
  const lines = Array.from({ length: 60 }, (_, index) => `Line ${index}, plain.`)
  const { entry } = await openReported(page, `${lines.join('\n\n')}\n\nFinally MAIN-12.`)
  const link = reference(entry, 'MAIN-12')
  const where = () => link.evaluate((element) => element.getBoundingClientRect().top)
  const before = await where()
  expect(before).toBeGreaterThan(900)
  await tabTo(page, link)
  await expect.poll(where).toBeLessThan(900)
  const shown = card(page)
  // A scroll lands within a frame or two; give it the time and read the card after it.
  await pause(300)
  await expect(shown).toBeVisible()
  await expect(shown).toContainText('MAIN-12')
  await expect(shown).toBeInViewport()
})

test('a card focus holds up leaves with its reference when a wheel takes that off the window', async ({
  page,
}) => {
  const lines = Array.from({ length: 60 }, (_, index) => `Line ${index}, plain.`)
  const { entry } = await openReported(page, `MAIN-12 first.\n\n${lines.join('\n\n')}`)
  await entry.getByRole('button', { name: 'Show all', exact: true }).click()
  const link = reference(entry, 'MAIN-12')
  await tabTo(page, link)
  const shown = card(page)
  await expect(shown).toBeVisible()
  // Over the drawer, away from the reference and from the card.
  await page.mouse.move(1200, 200)
  await page.mouse.wheel(0, 900)
  await expect(link).not.toBeInViewport()
  await expect(link).toBeFocused()
  await expect(shown).toBeHidden()

  await page.mouse.wheel(0, -900)
  await expect(link).toBeInViewport()
  await expect(shown).toBeVisible()
})

test('Enter opens the task and the card does not come back', async ({ page }) => {
  const { drawer, entry } = await openReported(page)
  const link = reference(entry, 'MAIN-265')
  await tabTo(page, link)
  await expect(card(page)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(card(page)).toHaveCount(0)
  await expect(drawer).toContainText('Wire contract freeze')
  expect(await cardsAfterTheDelay(page)).toBe(0)
})

test('Escape in the drawer closes the card alone, and the next one closes the drawer', async ({
  page,
}) => {
  const { drawer, entry } = await openReported(page)
  const draft = drawer.locator('.discussion-form').getByRole('textbox')
  await draft.fill('A draft in progress')
  await draft.focus()
  const link = reference(entry, 'MAIN-12')
  await rest(page, link)
  const shown = card(page)
  await expect(shown).toBeVisible()
  const place = await middle(link)

  await page.keyboard.press('Escape')
  await expect(shown).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await expect(draft).toBeFocused()
  await expect(draft).toHaveValue('A draft in progress')
  // The pointer has not moved, and resting on still does not reopen it.
  expect(await middle(link)).toEqual(place)
  await page.mouse.move(place.x + 1, place.y)
  expect(await cardsAfterTheDelay(page)).toBe(0)

  // With no card up the key is the drawer's again, and it asks about the draft.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).not.toHaveCount(0)
})

test('Escape in the list of questions closes the card alone, then the list', async ({ page }) => {
  const { dialog } = await openHub(page)
  await rest(page, reference(dialog, 'MAIN-12'))
  const shown = card(page)
  await expect(shown).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(shown).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(HUB_PROMPT)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('focus an overlay gives back after Escape does not bring the card up', async ({ page }) => {
  const { entry } = await openReported(page)
  const link = reference(entry, 'MAIN-12')
  await tabTo(page, link)
  const shown = card(page)
  await expect(shown).toBeVisible()

  // Something opens over the card: it goes, since the pointer could not tell it to.
  await page.keyboard.press('Control+k')
  const finder = page.getByRole('dialog', { name: 'Find', exact: false })
  await expect(finder).toBeVisible()
  await expect(shown).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(finder).toHaveCount(0)
  await expect(link).toBeFocused()
  expect(await link.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  expect(await cardsAfterTheDelay(page)).toBe(0)

  // A Tab away and back is the reader's own choice again.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(link).toBeFocused()
  await expect(shown).toBeVisible()
})

test('focus given back to a reference the pointer rests on does not bring the card up', async ({
  page,
}) => {
  const { entry } = await openReported(page)
  const link = reference(entry, 'MAIN-12')
  // A press that ends off the reference gives it focus and opens nothing.
  await rest(page, link)
  await page.mouse.down()
  await page.mouse.move(5, 5, { steps: 3 })
  await page.mouse.up()
  await expect(link).toBeFocused()
  await rest(page, link)
  const shown = card(page)
  await expect(shown).toBeVisible()

  await page.keyboard.press('Control+k')
  const finder = page.getByRole('dialog', { name: 'Find', exact: false })
  await expect(finder).toBeVisible()
  await expect(shown).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(finder).toHaveCount(0)
  await expect(link).toBeFocused()
  expect(await link.evaluate((element) => element.matches(':hover'))).toBe(true)
  expect(await cardsAfterTheDelay(page)).toBe(0)
})

test('a surface opening over a card the pointer holds up closes it', async ({ page }) => {
  const { drawer, entry } = await openReported(page)
  // Focus is in the draft, so nothing about focus tells the card; the pointer has not moved.
  await drawer.locator('.discussion-form').getByRole('textbox').focus()
  await rest(page, reference(entry, 'MAIN-12'))
  const shown = card(page)
  await expect(shown).toBeVisible()
  // Read straight after the surface opens: the browser's next hit test would close it too,
  // later and only if one comes, and until then the card lay over the new surface.
  const stillUp = page.evaluate(
    (selector) =>
      new Promise<number>((resolve) => {
        const opened = document.querySelectorAll('.overlay-host').length
        const seen = new MutationObserver(() => {
          if (document.querySelectorAll('.overlay-host').length === opened) return
          seen.disconnect()
          setTimeout(() => resolve(document.querySelectorAll(selector).length))
        })
        seen.observe(document.body, { childList: true, subtree: true })
      }),
    CARD,
  )
  await page.keyboard.press('Control+k')
  expect(await stillUp).toBe(0)
  await expect(page.getByRole('dialog', { name: 'Find', exact: false })).toBeVisible()
})

test('a surface opening while the card still waits calls it off', async ({ page }) => {
  const { entry } = await openReported(page)
  await rest(page, reference(entry, 'MAIN-12'))
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: 'Find', exact: false })).toBeVisible()
  expect(await cardsAfterTheDelay(page)).toBe(0)
})

test('a focus move that is not a Tab shows no card, under the pointer or not', async ({ page }) => {
  const { entry } = await openReported(page)
  const link = reference(entry, 'MAIN-12')
  await link.focus()
  expect(await cardsAfterTheDelay(page)).toBe(0)

  // Dismissed under the pointer, then given focus by a script: still dismissed.
  await page.keyboard.press('Tab')
  await coolDown()
  await rest(page, link)
  await expect(card(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card(page)).toHaveCount(0)
  await link.focus()
  expect(await cardsAfterTheDelay(page)).toBe(0)
})

test('nothing on the card or in its drawer breaks an accessibility rule', async ({ page }) => {
  const { entry } = await openReported(page)
  await rest(page, reference(entry, 'MAIN-12'))
  await expect(card(page)).toBeVisible()
  const results = await new AxeBuilder({ page })
    .include('.reference-preview')
    .include('.thread-entry')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
})
