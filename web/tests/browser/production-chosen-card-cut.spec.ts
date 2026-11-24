/**
 * A card chosen to put work off until, whose number and title are longer than its field, in a
 * question's «Later…» and in the card's «Put off» (DESIGN.md, «Closing work from its card» and
 * «One-line labels»): the field keeps its place and width as the card is chosen, and the chosen
 * words end in an ellipsis where they are cut, whole in the field's hint. Beside the day and the
 * count, from 620px, the field has some 210px, and the words stood cut at its edge with nothing to
 * say there were more. At every width the layout changes at, in both languages.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { hint } from './hintFramesPage.ts'
import { spaceRef, spaceScope, workItem, workItemRef } from './planningFixtures.ts'
import { WORDS } from './questionGroupsPage.ts'
import { ofPurpose, openKinds } from './questionKindsPage.ts'
import { closingSpace } from './served/closing.ts'
import { test } from './test.ts'
import { placesIn, stayedPut } from './untilChoice.ts'

const WIDTHS = [320, 390, 620, 1024, 1280] as const
/** A card whose title no field of either place holds on its line. */
const LONG = {
  reference: 'MAIN-320',
  title:
    'Tray delivery adapter keeps every notice it could not hand over and sends each again after the next restart of the service',
}
const LABEL = `${LONG.reference} ${LONG.title}`

/** What the platform search finds for any words: the one open card with a long title. */
const found = (query: string) => ({
  interface_version: 'valkama-planning-search',
  query,
  limit: 50,
  has_more: false,
  items: [
    {
      target: { space_ref: spaceRef, reference: LONG.reference, writable: true },
      item: {
        work_item_id: '00000000-0000-4000-8000-000000000320',
        planning_space_id: workItem.planning_space_id,
        reference: LONG.reference,
        title: LONG.title,
        state: { name: 'Dev' },
        open: true,
        container_state: null,
        claim_ref: '',
      },
    },
  ],
  coverage: [{ space_ref: spaceRef, status: 'searched', reason: null }],
})

const searchLong = (page: Page) =>
  page.route('**/api/modules/planning/search?**', (route) =>
    route.fulfill({ json: found(new URL(route.request().url()).searchParams.get('q') ?? '') }),
  )

/** Choose the long card in `scope`'s field of a card. */
async function chooseLong(page: Page, scope: Locator, label: string) {
  const combo = scope.getByRole('combobox', { name: label })
  await combo.click()
  await combo.pressSequentially('tray')
  await page.getByRole('option', { name: LABEL }).click()
  await expect(combo).toHaveValue(LABEL)
}

/**
 * The chosen words are the card's number and title, drawn once; cut, they end in an ellipsis,
 * and the pointer resting on the field brings the whole words. `rest` lets the hint's rest pass.
 */
async function cutByTheRule(
  page: Page,
  scope: Locator,
  label: string,
  rest: () => Promise<unknown>,
) {
  const words = scope.locator('[data-chosen-words]')
  await expect(words).toHaveCount(1)
  await expect(words).toHaveText(LABEL)
  const drawn = await words.evaluate((node) => ({
    cut: node.scrollWidth > node.clientWidth,
    ending: getComputedStyle(node).textOverflow,
  }))
  // The title is longer than any field either place gives it.
  expect(drawn).toEqual({ cut: true, ending: 'ellipsis' })
  await scope.getByRole('combobox', { name: label }).hover()
  await rest()
  await expect(hint(page)).toHaveText(LABEL)
}

for (const locale of ['ru', 'en'] as const)
  for (const width of WIDTHS) {
    const words = WORDS[locale]

    test(`at ${width}px in ${locale} a long card chosen in «Later…» moves nothing and is cut with its hint`, async ({
      page,
    }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      const { record } = await openKinds(
        page,
        [ofPurpose('return', { prompt: 'Put off by a card' })],
        width,
        { prepare: () => searchLong(page) },
      )
      const one = record('Put off by a card')
      const later = one.getByRole('button', { name: words.later, exact: true })
      await later.click()
      const putOff = one.getByRole('button', { name: words.putOff, exact: true })
      const places = () => placesIn(one, one, words, [putOff, later])
      const before = await places()
      await chooseLong(page, one, words.card)
      await expect(putOff).toBeEnabled()
      stayedPut(await places(), before)
      await cutByTheRule(page, one, words.card, () => page.clock.runFor(1000))
    })

    test(`at ${width}px in ${locale} a long card chosen in the card's «Put off» moves nothing and is cut with its hint`, async ({
      page,
    }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await page.setViewportSize({ width, height: 900 })
      await installBackend(page, { space: closingSpace })
      await searchLong(page)
      await page.goto(
        serializePlatformRoute({
          module_id: 'planning',
          scope: spaceScope,
          entity: planningWorkItemEntity(workItemRef),
        }),
      )
      const drawer = page.locator('.drawer')
      await expect(drawer.locator('.card-facts')).toBeVisible()
      await drawer.locator('.card-facts .card-state').first().click()
      await page.getByRole('option', { name: 'Later' }).click()
      const dialog = page.getByRole('dialog', { name: words.putOff })
      // It steps up as it opens: measured on its way, it stands lower than it comes to rest.
      await expect(dialog).toHaveCSS('transform', 'none')
      const places = () => placesIn(page.locator('body'), dialog, words)
      const before = await places()
      await chooseLong(page, dialog, words.card)
      stayedPut(await places(), before)
      // The hint comes after half a second's rest on the page's own clock.
      await cutByTheRule(page, dialog, words.card, () => Promise.resolve())
    })
  }
