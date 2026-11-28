import AxeBuilder from '@axe-core/playwright'
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
import { requestedShot } from './keptShots.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

/**
 * An item's plan anchor, in the head as a mark and in Relations as a row: both are one
 * path of the card's, so a plan opens in the viewer at its anchor, in a browser and in
 * the desktop app alike, and one that cannot be opened is copied with the reason.
 *
 * A copy here lands in the page's clipboard (`pageClipboard.ts`); the tests that read one back
 * from the system clipboard are in `production-card-source-clipboard.spec.ts`.
 */

for (const place of ['browser', 'app'] as const) {
  test.describe(`in the ${place}`, () => {
    test.beforeEach(async ({ page }) => {
      if (place === 'app') await inTheApp(page)
    })

    test('the row of Relations opens the same place, and says what it does', async ({ page }) => {
      const drawer = await openCard(page)
      const row = await toRelations(drawer)
      const link = row.getByRole('link', { name: `Open the document in Valkama: ${ANCHOR}` })
      await expect(link).toHaveText(ANCHOR)

      await link.click()
      await expectViewerAtAnchor(page)
      await page.keyboard.press('Escape')

      await expect(link).toBeFocused()
      expect(await askedOfTheApp(page)).toEqual([])
    })
  })
}

test('in the app, a source that is not Markdown goes to the editor by the plan, at its line', async ({
  page,
}) => {
  await inTheApp(page)
  const drawer = await openCard(page, { source: 'src/a.ts:42' })
  const mark = drawer.locator('.identity-source')
  await expect(mark).toHaveAccessibleName(/^Open in .+: src\/a\.ts, line 42$/u)
  await mark.click()
  await expect
    .poll(() => askedOfTheApp(page))
    .toEqual([
      { path: { kind: 'file', project: 'demo', path: 'src/a.ts', line: 42 }, fallback: 'vscode' },
    ])
  await expect(page.locator('.document-drawer')).toHaveCount(0)
})

test('a source that holds no path is text: nothing to press and nothing asked', async ({
  page,
}) => {
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/documents/')) asked.push(request.url())
  })
  const text = 'Notion: the migration plan'
  const drawer = await openCard(page, { source: text })
  await expect(drawer.locator('.identity-source')).toHaveCount(0)

  const row = await toRelations(drawer)
  await expect(row.locator('.ref-value')).toHaveText(text)
  await expect(row.getByRole('button')).toHaveCount(0)
  await expect(row.getByRole('link')).toHaveCount(0)
  expect(asked).toEqual([])
})

test('the row of Relations breaks no accessibility rule', async ({ page }) => {
  const drawer = await openCard(page)
  await toRelations(drawer)
  const found = await new AxeBuilder({ page }).include('.ref-list').analyze()
  expect(found.violations).toEqual([])
})

/** The card head and its Relations at both widths and in both languages, in every state. */
for (const width of [1280, 390]) {
  for (const locale of ['en', 'ru'] as const) {
    const relations = locale === 'ru' ? 'Связи' : 'Relations'
    const fits = (page: Page, what: string) =>
      expectNoSilentClipping(page, `${what} at ${width}px in ${locale}`)

    test.describe(`at ${width}px in ${locale}`, () => {
      test('a plan reads and opens', async ({ page }) => {
        const drawer = await openCard(page, { locale, width })
        await expect(drawer.locator('.identity-source svg.lucide-file-text')).toBeVisible()
        await requestedShot(page, `open-head-${width}-${locale}`)
        await fits(page, 'the mark')
        const row = await toRelations(drawer, relations)
        await requestedShot(page, `open-relations-${width}-${locale}`)
        await fits(page, 'the row')
        await row.getByRole('link').click()
        await expectViewerAtAnchor(page)
        await requestedShot(page, `open-viewer-${width}-${locale}`)
      })

      test('a source that is gone reads and copies', async ({ page }) => {
        const gone =
          'docs/architecture/decisions/plans/2026-11-03-the-plan-that-moved-elsewhere.md#kb:gone'
        const drawer = await openCard(page, { locale, width, source: gone })
        await drawer.locator('.identity-source').click()
        await expect(page.locator('.notice')).toBeVisible()
        await requestedShot(page, `gone-head-${width}-${locale}`)
        await fits(page, 'the mark that copies')
        await toRelations(drawer, relations)
        await requestedShot(page, `gone-relations-${width}-${locale}`)
        await fits(page, 'the row that copies')
      })

      test('a source of words reads as text', async ({ page }) => {
        const drawer = await openCard(page, {
          locale,
          width,
          source: 'Notion: the migration plan',
        })
        await expect(drawer.locator('.identity-source')).toHaveCount(0)
        await requestedShot(page, `words-head-${width}-${locale}`)
        const row = await toRelations(drawer, relations)
        await expect(row.getByRole('button')).toHaveCount(0)
        await expect(row.getByRole('link')).toHaveCount(0)
        await requestedShot(page, `words-relations-${width}-${locale}`)
        await fits(page, 'the words')
      })
    })
  }
}
