import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { aCardAsking, BROKEN_PATH, HUGE_PATH, LINK, linkTo } from './documentBackend.ts'
import { test } from './test.ts'

/**
 * When a document may take focus: on an opening the person began, until they move it
 * themselves, and on a step they took inside the document. A read the window's return began
 * never does, whatever it comes to.
 *
 * The window's return here is a changed answer from the server and a `focus` event on the
 * window. A real change of tab gives a headless browser no such event, so that is as far as
 * this can prove it: the event is what the page listens to, and a person's return is not run.
 */

const READ = '**/api/documents/read*'

const REFUSED = {
  'too large': { status: 413, json: { error: { code: 'too_large', size: 986 * 1024 } } },
  'a failed read': { status: 500, json: { error: { code: 'internal' } } },
  'no file': { status: 404, json: { error: { code: 'not_found' } } },
}

const SHORTENED = {
  json: {
    project: 'demo',
    path: HUGE_PATH,
    markdown: '# Cut down\n\nShorter now.\n\n## The target <!-- kb:a7f3 -->\n\nThe block.\n',
    size: 60,
    modified_at: '2026-11-03T15:20:00Z',
    revision: 'bbbbbbbbbbbbbbbb',
  },
}

const CHANGED = { json: { ...SHORTENED.json, path: 'docs/notes.md', revision: 'cccccccccccccccc' } }

const doNothing = () => {}

/** Every read from here on waits to be let go, then answers this or as it would have. */
async function heldReads(page: Page, answer?: object) {
  let letGo = doNothing
  const released = new Promise<void>((resolve) => {
    letGo = resolve
  })
  await page.route(READ, async (route) => {
    await released
    await (answer ? route.fulfill(answer) : route.fallback()).catch(() => {})
  })
  return letGo
}

const answering = (page: Page, answer: object) => page.route(READ, (route) => route.fulfill(answer))

/** What the page listens to when the window comes back; see the head of this file. */
const windowComesBack = (page: Page) =>
  page.evaluate(() => {
    globalThis.dispatchEvent(new Event('focus'))
  })

const paneOf = (page: Page) => {
  const pane = page.locator('.overlay-pane')
  return {
    pane,
    title: pane.locator('.overlay-header-name'),
    target: pane.locator('.document-block.is-target'),
    text: pane.locator('.document-text'),
    // The panel stands there while the read is under way too, and says so.
    refusal: pane.locator('.document-refusal .platform-state-panel:not([aria-busy])'),
  }
}

async function openFromCard(page: Page, path: string, press: 'key' | 'pointer' = 'key') {
  await page.setViewportSize({ width: 1500, height: 900 })
  const opened = await aCardAsking(page, `Read \`${path}\` first.`)
  return { ...opened, link: linkTo(opened.drawer, path), press }
}

async function pressLink(link: Locator, press: 'key' | 'pointer') {
  if (press === 'pointer') await link.click()
  else {
    await link.focus()
    await link.press('Enter')
  }
}

for (const locale of ['en-US', 'ru-RU'])
  test.describe(`in ${locale}`, () => {
    test.use({ locale })

    test.describe('the window comes back', () => {
      for (const [name, path] of [
        ['a refusal turned text', HUGE_PATH],
        ['a refusal turned text at an anchor', `${HUGE_PATH}#kb:a7f3`],
      ] as const)
        test(`${name} leaves focus in the field being typed in`, async ({ page }) => {
          const { comment, link } = await openFromCard(page, path)
          await pressLink(link, 'key')
          const { refusal, text, title } = paneOf(page)
          await expect(refusal).toBeVisible()
          await comment.click()
          await page.keyboard.type('one two ')

          await answering(page, SHORTENED)
          await windowComesBack(page)
          await expect(title).toHaveText('Cut down')
          await expect(text).toBeVisible()
          await expect(comment).toBeFocused()
          await page.keyboard.type('three four')
          await expect(comment).toHaveValue('one two three four')
        })

      test('a text unchanged leaves focus where it is', async ({ page }) => {
        const { comment, link } = await openFromCard(page, 'docs/notes.md')
        await pressLink(link, 'key')
        await expect(paneOf(page).text).toBeVisible()
        await comment.click()
        // Nothing on the page changes to wait for, so the second read is what is waited on.
        const readAgain = page.waitForResponse(READ)
        await windowComesBack(page)
        await readAgain
        await expect(comment).toBeFocused()
      })

      test('a text changed leaves focus where it is', async ({ page }) => {
        const { comment, link } = await openFromCard(page, 'docs/notes.md')
        await pressLink(link, 'key')
        const { pane, text } = paneOf(page)
        await expect(text).toBeVisible()
        await comment.click()
        await answering(page, CHANGED)
        await windowComesBack(page)
        await expect(pane).toContainText('Shorter now.')
        await expect(comment).toBeFocused()
      })

      test('a text turned refusal leaves focus where it is', async ({ page }) => {
        const { comment, link } = await openFromCard(page, 'docs/notes.md')
        await pressLink(link, 'key')
        const { refusal, text } = paneOf(page)
        await expect(text).toBeVisible()
        await comment.click()
        await answering(page, REFUSED['too large'])
        await windowComesBack(page)
        await expect(refusal).toBeVisible()
        await expect(comment).toBeFocused()
      })

      test('a refusal holding focus, turned text, leaves it in the document', async ({ page }) => {
        const { drawer, link } = await openFromCard(page, HUGE_PATH)
        await pressLink(link, 'key')
        const { pane, refusal, text, title } = paneOf(page)
        await expect(refusal).toBeVisible()
        await pane.locator('.document-refusal').evaluate((node: HTMLElement) => {
          node.focus()
        })
        await answering(page, SHORTENED)
        await windowComesBack(page)
        await expect(text).toBeVisible()
        await expect(title).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(pane).toHaveCount(0)
        await expect(drawer).toBeVisible()
        await expect(link).toBeFocused()
      })
    })

    test.describe('focus the person moved during the read stays', () => {
      for (const press of ['key', 'pointer'] as const)
        test(`a press on the field, after a link opened by ${press}`, async ({ page }) => {
          const { comment, link } = await openFromCard(page, LINK)
          const letGo = await heldReads(page)
          await pressLink(link, press)
          const { target, text, title } = paneOf(page)
          await expect(title).toBeFocused()
          await comment.click()
          await page.keyboard.type('one two ')
          letGo()
          await expect(text).toBeVisible()
          // The block a link names is still brought up and marked; only focus is left alone.
          await expect(target).toBeVisible()
          await expect(comment).toBeFocused()
          await page.keyboard.type('three four')
          await expect(comment).toHaveValue('one two three four')
        })

      test('Tab inside the pane', async ({ page }) => {
        const { link } = await openFromCard(page, LINK)
        const letGo = await heldReads(page)
        await pressLink(link, 'key')
        const { pane, text, title } = paneOf(page)
        await expect(title).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(title).not.toBeFocused()
        const moved = await page.evaluate(() => {
          document.activeElement?.setAttribute('data-moved-here', '')
          return document.activeElement?.closest('.overlay-pane') !== null
        })
        expect(moved).toBe(true)
        letGo()
        await expect(text).toBeVisible()
        await expect(pane.locator('[data-moved-here]')).toBeFocused()
      })

      test('Shift+F6 back to the link, and a text arrives', async ({ page }) => {
        const { link } = await openFromCard(page, LINK)
        const letGo = await heldReads(page)
        await pressLink(link, 'key')
        const { text, title } = paneOf(page)
        await expect(title).toBeFocused()
        await page.keyboard.press('Shift+F6')
        await expect(link).toBeFocused()
        letGo()
        await expect(text).toBeVisible()
        await expect(link).toBeFocused()
      })

      for (const [name, path, answer] of [
        ['too large', HUGE_PATH, REFUSED['too large']],
        ['a failed read', BROKEN_PATH, REFUSED['a failed read']],
        ['no file', 'docs/gone.md', REFUSED['no file']],
      ] as const)
        test(`Shift+F6 back to the link, and ${name} arrives`, async ({ page }) => {
          const { link } = await openFromCard(page, path)
          const letGo = await heldReads(page, answer)
          await pressLink(link, 'key')
          const { refusal, title } = paneOf(page)
          await expect(title).toBeFocused()
          await page.keyboard.press('Shift+F6')
          await expect(link).toBeFocused()
          letGo()
          await expect(refusal).toBeVisible()
          await expect(link).toBeFocused()
        })

      test('a press on the card during a step inside the document', async ({ page }) => {
        const { comment, link } = await openFromCard(page, 'docs/plan.md')
        await pressLink(link, 'key')
        const { pane, text, title } = paneOf(page)
        await expect(text).toBeVisible()
        const letGo = await heldReads(page)
        await linkTo(pane, 'notes.md').press('Enter')
        await expect(title).toBeFocused()
        await comment.click()
        letGo()
        await expect(title).toHaveText('The notes')
        await expect(comment).toBeFocused()
      })
    })

    test.describe('with nothing moved, the document still takes focus', () => {
      test('at the anchor, past the title it stood on as the read began', async ({ page }) => {
        const { link } = await openFromCard(page, LINK)
        const letGo = await heldReads(page)
        await pressLink(link, 'key')
        const { target, title } = paneOf(page)
        await expect(title).toBeFocused()
        letGo()
        await expect(target).toBeFocused()
      })

      test('though a key was pressed that moved no focus', async ({ page }) => {
        const { link } = await openFromCard(page, LINK)
        const letGo = await heldReads(page)
        await pressLink(link, 'key')
        const { target, title } = paneOf(page)
        await expect(title).toBeFocused()
        await page.keyboard.press('PageDown')
        await expect(title).toBeFocused()
        letGo()
        await expect(target).toBeFocused()
      })

      test('on the link pressed again, once focus has gone back to it', async ({ page }) => {
        const { drawer, link } = await openFromCard(page, 'docs/notes.md')
        const letGo = await heldReads(page)
        await pressLink(link, 'key')
        const { title } = paneOf(page)
        await expect(title).toBeFocused()
        await page.keyboard.press('Shift+F6')
        await expect(link).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(title).toBeFocused()
        letGo()
        await expect(drawer).toBeVisible()
        await expect(title).toBeFocused()
      })

      test('on a step inside the document, and on Back to the link it left by', async ({
        page,
      }) => {
        const { link } = await openFromCard(page, 'docs/plan.md')
        await pressLink(link, 'key')
        const { pane, title, text } = paneOf(page)
        await expect(text).toBeVisible()
        const inside = linkTo(pane, 'notes.md')
        await inside.press('Enter')
        await expect(title).toHaveText('The notes')
        await expect(title).toBeFocused()
        await pane.locator('.document-head button').first().press('Enter')
        await expect(title).toHaveText('The migration plan')
        await expect(inside).toBeFocused()
      })
    })

    test('over a card, focus moved during the read stays in the drawer', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
      const link = linkTo(drawer, LINK)
      const letGo = await heldReads(page)
      await pressLink(link, 'key')
      const over = page.locator('.document-drawer')
      await expect(over.locator('.document-viewer')).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('A')
      await page.keyboard.press('Tab')
      await page.evaluate(() => document.activeElement?.setAttribute('data-moved-here', ''))
      letGo()
      await expect(over.locator('.document-text')).toBeVisible()
      await expect(over.locator('[data-moved-here]')).toBeFocused()
    })

    test('over a card, with nothing moved, focus goes to the anchor', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
      const link = linkTo(drawer, LINK)
      const letGo = await heldReads(page)
      await pressLink(link, 'key')
      const over = page.locator('.document-drawer')
      await expect(over.locator('.document-viewer')).toBeVisible()
      letGo()
      await expect(over.locator('.document-block.is-target')).toBeFocused()
    })
  })
