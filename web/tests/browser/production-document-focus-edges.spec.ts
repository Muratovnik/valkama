import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

import { installBackend } from './backend.ts'
import { BROKEN_PATH, HUGE_PATH, LINK } from './documentBackend.ts'
import {
  answering,
  heldReads,
  openFromCard,
  paneOf,
  pressLink,
  READ,
  settledRefusal,
  SHORTENED,
  windowComesBack,
} from './documentFocusMoves.ts'
import { addressOf, installDocuments } from './documentPageSurface.ts'
import { test } from './test.ts'

/**
 * The edges of when a document may take focus. The right protects focus something holds: with
 * focus on nothing a landing takes it from nobody, whoever began the read. And a change of
 * host because the window changed width is nobody's move, whatever key came before it.
 */

const TOO_LARGE = { status: 413, json: { error: { code: 'too_large', size: 986 * 1024 } } }
const ANCHORED = `${HUGE_PATH}#kb:a7f3`
const REFRESH = /^(Refresh|Обновить)$/u

const refuse = (route: Route) => route.fulfill(TOO_LARGE)

/** A page of its own for a file that is refused as it loads, and how to make it readable. */
async function pageRefused(page: Page) {
  await page.setViewportSize({ width: 1500, height: 900 })
  await installBackend(page)
  await installDocuments(page)
  await page.route(READ, refuse)
  await page.goto(addressOf('docs/plan.md'))
  await expect(settledRefusal(page)).toBeVisible()
  return () => page.unroute(READ, refuse)
}

const focusOnNothing = (page: Page) =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    return document.activeElement === document.body
  })

const keyThatMovesNothing = async (page: Page, pressed: boolean) => {
  if (pressed) await page.keyboard.press('Shift')
}

for (const locale of ['en-US', 'ru-RU'])
  test.describe(`in ${locale}`, () => {
    test.use({ locale })

    test.describe('focus on nothing as the window comes back and a refusal turns text', () => {
      test('on its own page the keys that scroll work', async ({ page }) => {
        const readable = await pageRefused(page)
        await readable()
        await windowComesBack(page)
        const body = page.locator('.document-body')
        await expect(page.locator('.document-text')).toBeVisible()
        await expect(body).toBeFocused()
        await page.keyboard.press('PageDown')
        await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
      })

      test('beside a card it lands on the anchor', async ({ page }) => {
        const { link } = await openFromCard(page, ANCHORED)
        await pressLink(link, 'key')
        const { refusal, target } = paneOf(page)
        await expect(refusal).toBeVisible()
        expect(await focusOnNothing(page)).toBe(true)
        await answering(page, SHORTENED)
        await windowComesBack(page)
        await expect(target).toBeFocused()
      })

      test('over a card it lands on the anchor', async ({ page }) => {
        const { link } = await openFromCard(page, ANCHORED, 1280)
        await pressLink(link, 'key')
        const over = page.locator('.document-drawer')
        await expect(settledRefusal(over)).toBeVisible()
        expect(await focusOnNothing(page)).toBe(true)
        await answering(page, SHORTENED)
        await windowComesBack(page)
        await expect(over.locator('.document-block.is-target')).toBeFocused()
      })
    })

    test.describe('focus something holds as the window comes back and a refusal turns text', () => {
      test('on its own page a control keeps it', async ({ page }) => {
        const readable = await pageRefused(page)
        await page.keyboard.press('Tab')
        const held = await page.evaluate(() => {
          document.activeElement?.setAttribute('data-held', '')
          return document.activeElement !== document.body
        })
        expect(held).toBe(true)
        await readable()
        await windowComesBack(page)
        await expect(page.locator('.document-text')).toBeVisible()
        await expect(page.locator('[data-held]')).toBeFocused()
      })

      test('beside a card the field being typed in keeps it', async ({ page }) => {
        const { comment, link } = await openFromCard(page, ANCHORED)
        await pressLink(link, 'key')
        const { refusal, text } = paneOf(page)
        await expect(refusal).toBeVisible()
        await comment.click()
        await answering(page, SHORTENED)
        await windowComesBack(page)
        await expect(text).toBeVisible()
        await expect(comment).toBeFocused()
      })
    })

    test('Refresh that turns a failed read to text keeps focus on itself', async ({ page }) => {
      const { link } = await openFromCard(page, BROKEN_PATH)
      await pressLink(link, 'key')
      const { pane, refusal, text } = paneOf(page)
      await expect(refusal).toBeVisible()
      await answering(page, { json: { ...SHORTENED.json, path: BROKEN_PATH } })
      const refresh = pane.getByRole('button', { name: REFRESH })
      await refresh.click()
      await expect(text).toBeVisible()
      await expect(refresh).toBeFocused()
    })

    test.describe('a change of host while the read is held', () => {
      for (const [from, to] of [
        [1500, 1280],
        [1500, 390],
        [1280, 1500],
      ] as const)
        for (const key of [false, true])
          test(`${from} to ${to}, ${key ? 'after' : 'with no'} a key that moved nothing: the anchor takes focus`, async ({
            page,
          }) => {
            const { drawer, link } = await openFromCard(page, LINK, from)
            const letGo = await heldReads(page)
            await pressLink(link, 'key')
            const viewer = page.locator('.document-viewer')
            await expect(viewer).toBeVisible()
            await expect
              .poll(() => viewer.evaluate((node) => node.contains(document.activeElement)))
              .toBe(true)
            await keyThatMovesNothing(page, key)
            const inPane = page.locator('.overlay-pane .document-viewer')
            await page.setViewportSize({ width: to, height: 900 })
            await expect(inPane).toHaveCount(to === 1500 ? 1 : 0)
            letGo()
            const target = page.locator('.document-viewer .document-block.is-target')
            await expect(target).toBeFocused()
            await page.keyboard.press('Escape')
            await expect(viewer).toHaveCount(0)
            await expect(drawer).toBeVisible()
          })
    })
  })
