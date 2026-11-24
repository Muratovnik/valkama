/**
 * A centred dialog keeps the top it opened at while what it holds grows or shrinks, so what comes
 * into it after it opens moves only what stands under it (DESIGN.md, «Dialogs and drawers»).
 * Centred all along, it grew by half at each edge and moved its title and its fields under the
 * hand. Read in two of them, at every width the layout changes at and in both languages: the
 * card's «Put off», as the «whichever comes first» line appears and as a refusal comes, whose
 * reason stands right under why it waits rather than across the reason's empty room; and the
 * split of a part, as its reason goes and as a refusal comes. The press that first holds it
 * moves it not even for the frame it lands in, with less motion asked for as well: there every
 * property moves for an instant, and the dialog stood at the room's top under the press, which
 * came up on whatever stood there instead.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import type { BackendOptions } from './backend.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'
import { closingSpace } from './served/closing.ts'
import { CONDITIONS, goalSpace, placedCard } from './served/dividing.ts'
import { test } from './test.ts'
import { UNTIL_WORDS } from './untilChoice.ts'

const WIDTHS = [320, 390, 620, 1024, 1280] as const
const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: spaceScope,
  entity: planningWorkItemEntity(workItemRef),
})
/** What the server says as it refuses a write, in the words a refusal of the card's has. */
const REFUSAL = 'The card changed while this window was open: read it again and try once more.'
/** The gap between the fields of «Put off», which nothing between two of them may exceed. */
const FIELD_GAP = 12

const WORDS = {
  en: {
    ...UNTIL_WORDS.en,
    putOff: 'Put off',
    why: 'Why it waits',
    more: 'More',
    split: 'Split off a part…',
    splitTitle: 'Split off a part',
    name: 'Title',
    create: 'Create',
  },
  ru: {
    ...UNTIL_WORDS.ru,
    putOff: 'Отложить',
    why: 'Почему ждёт',
    more: 'Ещё',
    split: 'Отделить часть…',
    splitTitle: 'Отделить часть',
    name: 'Название',
    create: 'Создать',
  },
} as const
type Locale = keyof typeof WORDS

async function openCard(page: Page, locale: Locale, width: number, options: BackendOptions) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, options)
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await settled(page)
  return drawer
}

/** Once nothing moves on its own: a dialog steps up as it opens, and the drawer slides in. */
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document.getAnimations().every(({ playState }) => playState !== 'running'),
  )

/** Where each box stands in the window, as one frame draws them all. */
async function tops(locators: Locator[]) {
  const first = locators[0]
  if (!first) throw new Error('nothing to measure')
  const handles = await Promise.all(locators.map((locator) => locator.elementHandle()))
  try {
    return await first.page().evaluate(
      (elements) =>
        elements.map((element) => {
          const { bottom, left, top } = element.getBoundingClientRect()
          return { bottom, left, top }
        }),
      handles,
    )
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()))
  }
}

/** How far under the foot of `upper` the top of `lower` stands, as one frame draws both. */
async function gapUnder(upper: Locator, lower: Locator) {
  const [above, under] = await tops([upper, lower])
  if (!above || !under) throw new Error('a box is not drawn')
  return under.top - above.bottom
}

/** Each box of `now` stands where it stood in `before`, to half a pixel. */
function stood(
  now: Awaited<ReturnType<typeof tops>>,
  before: Awaited<ReturnType<typeof tops>>,
  names: string[],
) {
  expect(now).toHaveLength(names.length)
  expect(before).toHaveLength(names.length)
  const seen = JSON.stringify({ names, now, before })
  for (const [index, name] of names.entries())
    for (const key of ['top', 'left'] as const)
      expect(
        Math.abs((now[index]?.[key] ?? Number.NaN) - (before[index]?.[key] ?? Number.NaN)),
        `${name} ${key}: ${seen}`,
      ).toBeLessThanOrEqual(0.5)
}

for (const locale of ['ru', 'en'] as const)
  for (const width of WIDTHS) {
    const words = WORDS[locale]

    test(`at ${width}px in ${locale} «Put off» keeps its title and fields still as the line and a refusal come`, async ({
      page,
    }) => {
      const drawer = await openCard(page, locale, width, { space: closingSpace })
      const sent: unknown[] = []
      await page.route('**/api/planning/work-item/defer', async (route) => {
        sent.push(route.request().postDataJSON())
        await route.fulfill({
          status: 409,
          json: { error: { code: 'conflict', message: REFUSAL } },
        })
      })
      await drawer.locator('.card-facts .card-state').first().click()
      await page.getByRole('option', { name: 'Later' }).click()
      const dialog = page.getByRole('dialog', { name: words.putOff })
      // It steps up as it opens: measured on its way, it stands lower than it comes to rest.
      await expect(dialog).toHaveCSS('transform', 'none')
      const title = dialog.getByRole('heading', { name: words.putOff, exact: true })
      const day = dialog.getByLabel(words.day)
      const count = dialog.getByLabel(words.count)
      const card = dialog.getByText(words.card, { exact: true })
      const why = dialog.getByLabel(words.why)

      // The line that says which comes first appears under the day and the count: it takes its
      // own room under them, and the title and both fields stay where they were.
      await day.fill('2099-03-01')
      const above = [title, day, count]
      const lineless = await tops(above)
      await count.fill('3')
      await expect(dialog.locator('[data-until="either"]')).toBeVisible()
      stood(await tops(above), lineless, ['title', 'day', 'count'])

      // A refusal leaves the window open with all that was chosen and moves nothing that was
      // there; its reason stands right under why it waits, no further than a field from it.
      await why.fill('After the release')
      const fields = [title, day, count, card, why]
      const asked = await tops(fields)
      await dialog.getByRole('button', { name: words.putOff, exact: true }).click()
      const refusal = dialog.getByRole('alert').filter({ hasText: REFUSAL })
      await expect(refusal).toBeVisible()
      expect(sent).toHaveLength(1)
      stood(await tops(fields), asked, ['title', 'day', 'count', 'card', 'why'])
      const gap = await gapUnder(why, refusal)
      expect(gap).toBeGreaterThanOrEqual(0)
      expect(gap).toBeLessThanOrEqual(FIELD_GAP + 0.5)
    })

    test(`at ${width}px in ${locale} with less motion the press that holds «Put off» moves it not even for a frame`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const drawer = await openCard(page, locale, width, { space: closingSpace })
      await drawer.locator('.card-facts .card-state').first().click()
      await page.getByRole('option', { name: 'Later' }).click()
      const dialog = page.getByRole('dialog', { name: words.putOff })
      // Its step up is an instant now, and still ends a frame after it opens.
      await expect(dialog).toHaveCSS('transform', 'none')
      const title = dialog.getByRole('heading', { name: words.putOff, exact: true })
      const day = dialog.getByLabel(words.day)
      const shown = await tops([title])
      // Where the title stands as the button goes down, after the press has held the dialog and
      // before a frame has passed; and what the press comes up on.
      const heading = await title.elementHandle()
      await page.evaluate((element) => {
        const seen: { down?: number; up?: string } = {}
        Object.assign(window, { heldPress: seen })
        const once = { capture: true, once: true }
        document.addEventListener(
          'mousedown',
          () => (seen.down = element?.getBoundingClientRect().top),
          once,
        )
        document.addEventListener(
          'mouseup',
          (event) => (seen.up = (event.target as Element).localName),
          once,
        )
      }, heading)
      await heading?.dispose()
      await day.click()
      const seen = await page.evaluate(() => (window as unknown as { heldPress: unknown }).heldPress)
      expect(seen).toEqual({ down: expect.closeTo(shown[0]?.top ?? Number.NaN, 0), up: 'input' })
      stood(await tops([title]), shown, ['title'])
    })

    test(`at ${width}px in ${locale} the split of a part keeps its title and fields still as its reason goes and a refusal comes`, async ({
      page,
    }) => {
      const drawer = await openCard(page, locale, width, { space: goalSpace, card: placedCard })
      await page.route('**/api/planning/work-items', (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 409, json: { error: { code: 'conflict', message: REFUSAL } } })
          : route.fallback(),
      )
      await drawer
        .locator('.drawer-frame-bar')
        .getByRole('button', { name: words.more, exact: true })
        .click()
      await page.getByRole('menuitem', { name: words.split, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: words.splitTitle })
      // It steps up as it opens: measured on its way, it stands lower than it comes to rest.
      await expect(dialog).toHaveCSS('transform', 'none')
      const title = dialog.getByRole('heading', { name: words.splitTitle, exact: true })
      const name = dialog.getByRole('textbox', { name: words.name })
      const condition = dialog.locator(`[data-step="${CONDITIONS[2].id}"]`)
      const create = dialog.getByRole('button', { name: words.create, exact: true })
      const parts = [title, name, condition]
      const names = ['title', 'name', 'condition']

      // Ticking the condition makes «Create» available and takes the reason away.
      await name.fill('Alert settings survive a restart')
      await expect(create).toBeDisabled()
      const blocked = await tops(parts)
      await condition.getByRole('checkbox').click()
      await expect(create).toBeEnabled()
      stood(await tops(parts), blocked, names)

      const asked = await tops(parts)
      await create.click()
      await expect(dialog.getByRole('alert').filter({ hasText: REFUSAL })).toBeVisible()
      stood(await tops(parts), asked, names)
    })
  }
