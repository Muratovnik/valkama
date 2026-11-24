/**
 * A control focused from the keyboard in a dialog's body stands clear of the words over the
 * foot whatever moves them, and its focus ring stands whole at the body's own edges (DESIGN.md,
 * «Dialogs and drawers»; WCAG 2.4.11). The words come and grow under a focus that does not move:
 * a refusal arrives while the reader has already gone back into the form, and the window gets
 * shorter under them. Only a focus arriving was answered before: in «New work» 480px tall, a
 * Shift+Tab from the foot while the create waited put the focus on the description's tab, and
 * the refusal then stood over all 24px of it, with no ring in sight until the next key.
 *
 * A Shift+Tab upward through the body leaves the ring's top side whole at the body's top edge,
 * and a Tab downward its lower side at the lower edge: the browser scrolled a control flush with
 * the edge and cut off 3.6 to 4.5px of the 4px ring, as at the remove buttons of a long space
 * and the description's toolbar on a phone.
 *
 * Read in «New work» 480px tall at a desktop's, a narrow window's and two phones' widths, and in
 * the window of a space with eleven projects at every width its layout changes at, in both
 * languages. Served `served/graphSpaceFrames.ts` and `spaceWindowBackend.ts`'s double.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { bodyOverflows, focusStop, walkFocus } from './dialogFocus.ts'
import type { FocusStop } from './dialogFocus.ts'
import { frames } from './frames.ts'
import { spaceScope } from './planningFixtures.ts'
import { ITEMS, spaceFramesRead } from './served/graphSpaceFrames.ts'
import { spaceAnswer } from './servedAnswers.ts'
import { installSpaceWindowBackend, longSpaceWorld } from './spaceWindowBackend.ts'
import { openPortfolio, WORDS as SPACE_WORDS } from './spaceWindowPage.ts'
import { test } from './test.ts'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

/** What «New work» is called and says, in each language. */
const WORDS = {
  'ru-RU': {
    open: 'Новая работа',
    dialog: 'Новая работа',
    title: 'Название',
    noAnswer: 'Работа не создана: сервер не ответил. Введённое сохранено — попробуйте ещё раз.',
  },
  'en-US': {
    open: 'New work item',
    dialog: 'New work',
    title: 'Title',
    noAnswer:
      'The work was not created: the server did not answer. What you typed is kept; try again.',
  },
} as const
type Locale = keyof typeof WORDS

/** A window shorter than «New work»'s form, so the words over its foot stand over some of it. */
const SHORT = 480
/** How much shorter the window then gets under a focus that stays. */
const SHORTER = 400

/** Every control a walk stopped at that the words cover or the body's edges cut. */
const hidden = (stops: FocusStop[]) => stops.filter((stop) => stop.covered > 0 || stop.cut > 0)

async function keep(info: TestInfo, name: string, measured: unknown) {
  await info.attach(name, {
    body: JSON.stringify(measured, null, 1),
    contentType: 'application/json',
  })
}

/** A promise the test settles itself, to hold back an answer until it calls `release`. */
function holdBack() {
  let settle: ((value: undefined) => void) | undefined
  const held = new Promise<undefined>((done) => {
    settle = done
  })
  return { held, release: () => settle?.(undefined) }
}

/**
 * «New work» on the board, `width` wide and {@link SHORT} tall, its title typed; a create is
 * answered «not reached» once `release` is called, and not before.
 */
async function openComposer(page: Page, width: number, locale: Locale) {
  await page.setViewportSize({ width, height: SHORT })
  await installBackend(page)
  await page.route('**/api/planning?*', (route) =>
    route.fulfill(
      spaceAnswer(new URL(route.request().url()).searchParams, (model) => ({
        ...spaceFramesRead(ITEMS),
        planning_space: model.planning_space,
      })),
    ),
  )
  const { held, release } = holdBack()
  await page.route('**/api/planning/work-items', async (route) => {
    await held
    await route.fulfill({ status: 503, body: '' })
  })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
  const words = WORDS[locale]
  await page.getByRole('button', { name: words.open, exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: words.dialog })
  await expect(dialog).toHaveCSS('transform', 'none')
  await dialog.getByRole('textbox', { name: words.title }).fill('Rehearse the restore')
  return { dialog, release, create: dialog.getByRole('button', { name: words.open, exact: true }) }
}

/**
 * Scrolls the body as a reader's wheel would, leaving the focus where it is, until the focused
 * control's ring stands whole right at the body's lower edge: where words coming over the foot
 * would stand over it.
 */
const toLowerEdge = (dialog: Locator) =>
  dialog.evaluate((node) => {
    const body = node.querySelector('[data-part="dialog-body"]')
    const focused = document.activeElement
    if (!(body instanceof HTMLElement) || !(focused instanceof HTMLElement)) return
    const style = getComputedStyle(focused)
    const ring = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
    const lower = body.getBoundingClientRect().top + body.clientTop + body.clientHeight
    body.scrollTop += Math.ceil(focused.getBoundingClientRect().bottom + ring - lower) + 1
  })

/** Presses Shift+Tab from the foot, a few times at most, until the focus is in the body. */
async function backIntoForm(page: Page, dialog: Locator) {
  for (let press = 0; press < 4; press++) {
    await page.keyboard.press('Shift+Tab')
    const stop = await focusStop(dialog)
    if (stop) return stop
  }
  return null
}

for (const width of [1280, 620, 390, 320] as const)
  for (const locale of ['ru-RU', 'en-US'] as const)
    test.describe(`«New work» ${String(width)}×${String(SHORT)} in ${locale}`, () => {
      test.use({ locale })

      test('a refusal that comes after the focus, and a shorter window, leave it clear', async ({
        page,
      }, info) => {
        const { dialog, release, create } = await openComposer(page, width, locale)
        await create.click()
        // Back into the form from the foot while the create waits.
        expect(await backIntoForm(page, dialog), 'the focus came back into the form').not.toBeNull()
        expect(await bodyOverflows(dialog)).toBe(true)
        await toLowerEdge(dialog)
        const before = await focusStop(dialog)
        expect(before?.wordsTop, 'nothing is said yet').toBeNull()
        expect(before?.cut, JSON.stringify(before)).toBe(0)

        release()
        await expect(dialog.getByRole('alert')).toHaveText(WORDS[locale].noAnswer)
        await frames(dialog)
        const refused = await focusStop(dialog)
        // The words now stand where the focused control stood: what they would have covered.
        expect(refused?.wordsTop ?? Infinity).toBeLessThan(before?.ringBottom ?? 0)
        expect(refused?.name, 'the focus stayed where it was').toBe(before?.name)
        expect.soft(refused?.covered, JSON.stringify(refused)).toBe(0)
        expect.soft(refused?.cut, JSON.stringify(refused)).toBe(0)

        await page.setViewportSize({ width, height: SHORTER })
        await frames(dialog)
        const shorter = await focusStop(dialog)
        // The words now stand higher in the body than the ring's lower side stood.
        expect(shorter?.wordsTop ?? Infinity).toBeLessThan(refused?.ringBottom ?? 0)
        expect(shorter?.name, 'the focus stayed where it was').toBe(before?.name)
        expect.soft(shorter?.covered, JSON.stringify(shorter)).toBe(0)
        expect.soft(shorter?.cut, JSON.stringify(shorter)).toBe(0)
        await keep(info, `late-${String(width)}-${locale}`, { before, refused, shorter })
      })

      test('a walk up and down the form keeps the whole ring in the body', async ({
        page,
      }, info) => {
        const { dialog, create } = await openComposer(page, width, locale)
        expect(await bodyOverflows(dialog)).toBe(true)
        // Up from the foot to the title, then down from the title to the foot.
        const up = await walkFocus(page, dialog, create, { back: true })
        const title = dialog.getByRole('textbox', { name: WORDS[locale].title })
        const down = await walkFocus(page, dialog, title)
        expect(up.length, JSON.stringify(up)).toBeGreaterThanOrEqual(5)
        expect(down.length, JSON.stringify(down)).toBeGreaterThanOrEqual(5)
        expect.soft(hidden(up), 'Shift+Tab up').toEqual([])
        expect.soft(hidden(down), 'Tab down').toEqual([])
        await keep(info, `walk-${String(width)}-${locale}`, { up, down })
      })
    })

for (const { width, height } of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
  { width: 620, height: 800 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
] as const)
  for (const lang of ['en', 'ru'] as const)
    test.describe(`the window of a long space at ${String(width)} in ${lang}`, () => {
      test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })
      const words = SPACE_WORDS[lang]

      test('a walk up from the foot and down keeps the whole ring in the body', async ({
        page,
      }, info) => {
        await installSpaceWindowBackend(page, longSpaceWorld())
        await openPortfolio(page, { width, height })
        await page.getByRole('button', { name: words.configure('LNG') }).click()
        const dialog = page.getByRole('dialog', { name: words.editTitle('LNG') })
        await expect(dialog.locator('[data-project]').first()).toBeVisible()
        await expect(dialog).toHaveCSS('transform', 'none')
        expect(await bodyOverflows(dialog)).toBe(true)
        // The name, the key, the default, eleven removes, «Add project», «New project from folder…».
        const up = await walkFocus(
          page,
          dialog,
          dialog.getByRole('button', { name: words.remove }),
          {
            back: true,
          },
        )
        const down = await walkFocus(page, dialog, dialog.getByLabel(words.name, { exact: true }))
        expect(up.length, JSON.stringify(up)).toBeGreaterThanOrEqual(15)
        expect(down.length, JSON.stringify(down)).toBeGreaterThanOrEqual(14)
        expect.soft(hidden(up), 'Shift+Tab up').toEqual([])
        expect.soft(hidden(down), 'Tab down').toEqual([])
        await keep(info, `space-${String(width)}-${lang}`, { up, down })
      })
    })
