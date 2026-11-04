import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { aCardAsking, HUB_TITLE, LINK, linkIn } from './documentBackend.ts'
import { openBesideCard, paneOf, settled, shot } from './documentBeside.ts'
import { EDITOR } from './documentEditorPlan.ts'
import { addressOf, openPage } from './documentPageSurface.ts'
import { test } from './test.ts'

/**
 * Reading a file again from the viewer's head, when what comes back takes the pressed
 * control away: a file grown past what Valkama shows, or one deleted. Focus stays in the
 * viewer, so the next Escape is still the document's and not the card's behind it, and the
 * editor stays offered wherever a file it can read is there.
 */

const TOO_LARGE = { error: { code: 'too_large', size: 986 * 1024, limit: 512 * 1024 } }

/** From here on every read of the file answers this, as the disk would. */
async function diskAnswers(page: Page, answer: 'changed' | 'deleted' | 'too-large') {
  await page.unroute('**/api/documents/read*')
  await page.route('**/api/documents/read*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? ''
    if (answer === 'too-large') await route.fulfill({ status: 413, json: TOO_LARGE })
    else if (answer === 'deleted')
      await route.fulfill({ status: 404, json: { error: { code: 'not_found' } } })
    else
      await route.fulfill({
        json: {
          project: 'demo',
          path,
          markdown: '# The migration plan\n\nRewritten since.\n',
          size: 40,
          modified_at: '2026-11-03T15:20:00Z',
          revision: 'aaaaaaaaaaaaaaaa',
        },
      })
  })
}

const focusedNode = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement
    return {
      body: active === document.body,
      inPane: Boolean(active?.closest('.overlay-pane')),
      text: active?.textContent?.trim() ?? '',
    }
  })

test('beside a card: Refresh to a file grown past the limit keeps focus, and Escape closes the document only', async ({
  page,
}) => {
  const { drawer, comment } = await openBesideCard(page)
  await comment.fill('Half a thought')
  const link = linkIn(drawer, LINK)
  await link.click()
  const { pane, target } = paneOf(page)
  await expect(target).toBeFocused()
  const refresh = pane.getByRole('button', { name: 'Refresh' })
  const status = pane.locator('.document-status')

  await diskAnswers(page, 'changed')
  await refresh.click()
  await expect(status).toContainText('The file changed, so this is its new text')

  await diskAnswers(page, 'too-large')
  await refresh.click()
  await expect(pane).toContainText('The document is over 512 KiB')
  await expect(refresh).toHaveCount(0)
  // The line spoke of a text no longer shown.
  await expect(status).toHaveText('')
  const focused = await focusedNode(page)
  expect(focused).toEqual({ body: false, inPane: true, text: expect.stringContaining('986 KiB') })
  // A file too large to show is still one an editor opens.
  await expect(pane.getByRole('button', { name: EDITOR, exact: true })).toBeVisible()
  await settled(drawer)
  await shot(page, 'refresh-too-large-1500-en')

  await page.keyboard.press('Escape')
  await expect(pane).toHaveCount(0)
  await expect(link).toBeFocused()
  await expect(drawer.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0)
  await expect(comment).toHaveValue('Half a thought')
})

test('beside a card: Refresh to a deleted file keeps focus on the title, under the line that says so', async ({
  page,
}) => {
  const { drawer, comment } = await openBesideCard(page)
  await comment.fill('Half a thought')
  const link = linkIn(drawer, LINK)
  await link.click()
  const { pane, title, target } = paneOf(page)
  await expect(target).toBeFocused()

  await diskAnswers(page, 'deleted')
  await pane.getByRole('button', { name: 'Refresh' }).click()
  await expect(pane.locator('.document-status')).toHaveText(
    'The file was deleted from disk. This is the last text read',
  )
  await expect(pane.getByRole('button', { name: 'Refresh' })).toHaveCount(0)
  await expect(title).toBeFocused()
  await shot(page, 'refresh-deleted-1500-en')

  await page.keyboard.press('Escape')
  await expect(pane).toHaveCount(0)
  await expect(link).toBeFocused()
  await expect(drawer.getByRole('button', { name: 'Discard', exact: true })).toHaveCount(0)
})

test.describe('the editor is offered in every host, and for a file too large to show', () => {
  test('beside the questions waiting for an answer', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await page.getByRole('button', { name: /^Needs my answer/u }).click()
    const hub = page.getByRole('dialog', { name: HUB_TITLE })
    await settled(hub)
    await linkIn(hub, LINK).click()
    const { pane, target } = paneOf(page)
    await expect(target).toBeFocused()
    await expect(pane.getByRole('button', { name: EDITOR, exact: true })).toBeVisible()
  })

  test('over the questions waiting for an answer', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 })
    const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await page.getByRole('button', { name: /^Needs my answer/u }).click()
    const hub = page.getByRole('dialog', { name: HUB_TITLE })
    await settled(hub)
    await linkIn(hub, LINK).click()
    const viewer = page.locator('.document-drawer')
    await settled(viewer)
    await expect(viewer.getByRole('button', { name: EDITOR, exact: true })).toBeVisible()
  })

  test('on the page of a file too large to show', async ({ page }) => {
    await openPage(page, 'docs/plan.md')
    await expect(page.getByRole('button', { name: EDITOR, exact: true })).toBeVisible()
    await diskAnswers(page, 'too-large')
    await page.goto(addressOf('docs/plan.md'))
    await expect(page.locator('main')).toContainText('The document is over 512 KiB')
    await expect(page.getByRole('button', { name: EDITOR, exact: true })).toBeVisible()
  })
})
