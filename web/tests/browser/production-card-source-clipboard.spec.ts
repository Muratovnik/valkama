import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  ANCHOR,
  askedOfTheApp,
  expectViewerAtAnchor,
  inTheApp,
  openCard,
  toRelations,
} from './cardSourcePage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

/**
 * A card's plan anchor where the clipboard is part of what is checked: the mark that opens the
 * plan leaves the clipboard as it was, and a source that is not there is copied. Both read the
 * system clipboard back, which this spec is granted (`clipboardSpecs.ts`); the rest of the anchor
 * is in `production-card-source.spec.ts`.
 */

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-write', 'clipboard-read'])
})

const clipboardOf = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

for (const place of ['browser', 'app'] as const) {
  test.describe(`in the ${place}`, () => {
    test.beforeEach(async ({ page }) => {
      if (place === 'app') await inTheApp(page)
    })

    test('the mark opens the plan in the viewer at its anchor, and Escape comes back', async ({
      page,
    }) => {
      const drawer = await openCard(page)
      const mark = drawer.locator('.identity-source')
      await expect(mark).toHaveAccessibleName(`Open the document in Valkama: ${ANCHOR}`)
      await expect(mark).toHaveAttribute('data-tooltip', `Open the document in Valkama: ${ANCHOR}`)
      await expect(mark.locator('svg.lucide-file-text')).toBeVisible()
      await page.evaluate(() => navigator.clipboard.writeText('untouched'))

      await mark.focus()
      await page.keyboard.press('Enter')
      await expectViewerAtAnchor(page)
      await page.keyboard.press('Escape')

      await expect(page.locator('.document-drawer')).toHaveCount(0)
      await expect(mark).toBeFocused()
      expect(await clipboardOf(page)).toBe('untouched')
      expect(await askedOfTheApp(page)).toEqual([])
    })
  })
}

test('a source that is not there is copied as written, with the reason beforehand', async ({
  page,
}) => {
  const gone = 'docs/plans/gone.md#kb:missing'
  const drawer = await openCard(page, { source: gone })
  const mark = drawer.locator('.identity-source')
  await expect(mark).toHaveAccessibleName(`Copy the path ${gone}: nothing is there`)
  await expect(mark.locator('svg.lucide-copy')).toBeVisible()

  await mark.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => clipboardOf(page)).toBe(gone)
  await expect(page.locator('.notice')).toContainText('Path copied')
  await expect(mark).toBeFocused()
  await expect(page.locator('.document-drawer')).toHaveCount(0)
  await expectNoSilentClipping(page, 'card with a source that is gone')

  const row = await toRelations(drawer)
  const link = row.getByRole('button', { name: `Copy the path ${gone}: nothing is there` })
  await expect(link).toHaveText(gone)
  await expect(link).toHaveCSS('text-decoration-style', 'dotted')
})
