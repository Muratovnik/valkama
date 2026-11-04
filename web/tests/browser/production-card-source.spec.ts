import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { PLAN_PATH } from './planDocumentFixture.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * An item's plan anchor, in the head as a mark and in Relations as a row: both are one
 * path of the card's, so a plan opens in the viewer at its anchor, in a browser and in
 * the desktop app alike, and one that cannot be opened is copied with the reason.
 */

const ANCHOR = `${PLAN_PATH}#kb:arch-plan`

/** The page's side of the desktop bridge, and what it was asked to carry out. */
async function inTheApp(page: Page) {
  await page.addInitScript(() => {
    const asked: unknown[] = []
    Object.assign(window, {
      asked,
      valkamaDesktop: {
        onOpenRoute: () => {},
        openSession(request: unknown) {
          asked.push(request)
          return Promise.resolve({ ok: true, mode: 'opened', next: null })
        },
      },
    })
  })
}

/** Nothing in a browser, where no bridge stands to be asked. */
const askedOfTheApp = (page: Page) =>
  page.evaluate(() => (window as unknown as { asked?: unknown[] }).asked ?? [])

async function openCard(
  page: Page,
  {
    locale = 'en',
    source,
    width = 1280,
  }: { locale?: string; source?: string; width?: number } = {},
) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, source === undefined ? {} : { source })
  await page.context().grantPermissions(['clipboard-write', 'clipboard-read'])
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.getByRole('dialog').filter({ has: page.locator('.head-reference') })
  await expect(drawer.locator('.card-identity')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

async function toRelations(drawer: Locator, name = 'Relations') {
  await drawer.getByRole('tab', { name, exact: true }).click()
  return drawer.locator('.ref-row').first()
}

const clipboardOf = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

/** The viewer stands at the anchor's block, which holds focus and is on screen. */
async function expectViewerAtAnchor(page: Page) {
  const viewer = page.locator('.document-drawer')
  await expect(viewer).toHaveCSS('transform', 'none')
  await expect(viewer.locator('.overlay-header-name')).toHaveText('The platform plan')
  const target = viewer.locator('.document-block.is-target')
  await expect(target).toContainText('The architecture')
  await expect(target).toBeFocused()
  await expect(target).toBeInViewport()
  await expect
    .poll(() => viewer.locator('.document-body').evaluate((n) => n.scrollTop))
    .toBeGreaterThan(0)
}

/** Where a shot goes when a person asks for shots; a run without the setting takes none. */
async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder) await page.screenshot({ path: `${folder}/${name}.png` })
}

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
      await expect(mark).toHaveAttribute('title', `Open the document in Valkama: ${ANCHOR}`)
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
        await shot(page, `open-head-${width}-${locale}`)
        await fits(page, 'the mark')
        const row = await toRelations(drawer, relations)
        await shot(page, `open-relations-${width}-${locale}`)
        await fits(page, 'the row')
        await row.getByRole('link').click()
        await expectViewerAtAnchor(page)
        await shot(page, `open-viewer-${width}-${locale}`)
      })

      test('a source that is gone reads and copies', async ({ page }) => {
        const gone =
          'docs/architecture/decisions/plans/2026-11-03-the-plan-that-moved-elsewhere.md#kb:gone'
        const drawer = await openCard(page, { locale, width, source: gone })
        await drawer.locator('.identity-source').click()
        await expect(page.locator('.notice')).toBeVisible()
        await shot(page, `gone-head-${width}-${locale}`)
        await fits(page, 'the mark that copies')
        await toRelations(drawer, relations)
        await shot(page, `gone-relations-${width}-${locale}`)
        await fits(page, 'the row that copies')
      })

      test('a source of words reads as text', async ({ page }) => {
        const drawer = await openCard(page, {
          locale,
          width,
          source: 'Notion: the migration plan',
        })
        await expect(drawer.locator('.identity-source')).toHaveCount(0)
        await shot(page, `words-head-${width}-${locale}`)
        const row = await toRelations(drawer, relations)
        await expect(row.getByRole('button')).toHaveCount(0)
        await expect(row.getByRole('link')).toHaveCount(0)
        await shot(page, `words-relations-${width}-${locale}`)
        await fits(page, 'the words')
      })
    })
  }
}
