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
 * A description taller than the room the words leave keeps the line its caret is on in sight,
 * as a refusal comes and as the window gets shorter: kept by its lower end instead, at 1280 and
 * 1024 by 480 the caret on its first line went 52px over the body's top edge. The body itself,
 * which Chrome focuses while nothing in it can take focus, as in «Split off a part» while it
 * creates, is not scrolled for it: taken for a control in it, it went 43px toward its end on the
 * refusal and 60px more as the window got shorter.
 *
 * Read in «New work» 480px tall at a desktop's, a narrow window's and two phones' widths, and in
 * the window of a space with eleven projects at every width its layout changes at, in both
 * languages. Served `served/graphSpaceFrames.ts`, `served/dividing.ts` and
 * `spaceWindowBackend.ts`'s double.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { bodyOverflows, focusStop, walkFocus } from './dialogFocus.ts'
import type { FocusStop } from './dialogFocus.ts'
import { frames } from './frames.ts'
import { holdBack } from './heldWrite.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'
import { goalSpace, placedCard } from './served/dividing.ts'
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
    description: 'Описание',
    noAnswer: 'Работа не создана: сервер не ответил. Введённое сохранено — попробуйте ещё раз.',
  },
  'en-US': {
    open: 'New work item',
    dialog: 'New work',
    title: 'Title',
    description: 'Description',
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

/** Forty lines of a description, more than the field shows at its tallest. */
const LONG = Array.from(
  { length: 40 },
  (_, line) => `Step ${String(line + 1)}: stop the service, copy the store aside, restore it.`,
).join('\n')

/** What the body shows of what it holds, top to lower edge, the words' top while they stand. */
const shownRoom = (dialog: Locator) =>
  dialog.evaluate((node) => {
    const body = node.querySelector('[data-part="dialog-body"]')
    if (!body) return null
    const top = body.getBoundingClientRect().top + body.clientTop
    const words = node.querySelector('[data-part="said"]')?.getBoundingClientRect().top
    const edge = top + body.clientHeight
    return { top, lower: words === undefined ? edge : Math.min(edge, words) }
  })

/**
 * The line the caret is on in `field`, read off the field's own box and how far its text is
 * scrolled, for a caret at the start of its text or at its end: the first line stands under the
 * text's top padding, the last over its lower padding at the end of all it scrolls. `caret` is
 * where the caret is, which makes it that line.
 */
const caretAtEdge = (field: Locator, edge: 'end' | 'start') =>
  field.evaluate((node, at) => {
    const area = node as HTMLTextAreaElement
    const style = getComputedStyle(area)
    const line = Number.parseFloat(style.lineHeight)
    const box = area.getBoundingClientRect()
    const start = at === 'start'
    // Where the text's own top stands, scrolled as it is.
    const text = box.top + area.clientTop - area.scrollTop
    const top = start
      ? text + Number.parseFloat(style.paddingTop)
      : text + area.scrollHeight - Number.parseFloat(style.paddingBottom) - line
    return {
      top,
      bottom: top + line,
      height: box.height,
      caret: area.selectionEnd === area.selectionStart ? area.selectionStart : -1,
      expected: start ? 0 : area.value.length,
    }
  }, edge)

type CaretLine = Awaited<ReturnType<typeof caretAtEdge>>
type Room = Awaited<ReturnType<typeof shownRoom>>

/** The caret's line stands whole in what the body shows, and is the line `caretAtEdge` read. */
function inSight(line: CaretLine, room: Room, what: string) {
  const seen = JSON.stringify({ line, room })
  expect(line.caret, `${what}: the caret stayed where it was`).toBe(line.expected)
  expect
    .soft(line.top, `${what}: under the body's top edge ${seen}`)
    .toBeGreaterThanOrEqual(room?.top ?? Infinity)
  expect
    .soft(line.bottom, `${what}: over the words ${seen}`)
    .toBeLessThanOrEqual(room?.lower ?? -Infinity)
}

/** Scrolls the body as a reader's wheel would until `field`'s top stands at its top edge. */
const fieldToTop = (dialog: Locator) =>
  dialog.evaluate((node) => {
    const body = node.querySelector('[data-part="dialog-body"]')
    const area = node.querySelector('textarea')
    if (!(body instanceof HTMLElement) || !area) return
    const top = body.getBoundingClientRect().top + body.clientTop
    body.scrollTop += Math.floor(area.getBoundingClientRect().top - top) - 1
  })

for (const width of [1280, 1024] as const)
  for (const locale of ['ru-RU', 'en-US'] as const)
    test.describe(`a long description in «New work» ${String(width)}×${String(SHORT)} in ${locale}`, () => {
      test.use({ locale })

      test('the caret’s first line stays in sight as a refusal comes and the window gets shorter', async ({
        page,
      }, info) => {
        const { dialog, release } = await openComposer(page, width, locale)
        // Each create is answered at once.
        release()
        const field = dialog.getByRole('textbox', { name: WORDS[locale].description, exact: true })
        await field.fill(LONG)
        await field.press('Control+Home')
        await fieldToTop(dialog)
        const before = await caretAtEdge(field, 'start')
        const room = await shownRoom(dialog)
        expect(
          Math.abs(before.top - (room?.top ?? 0)),
          JSON.stringify({ before, room }),
        ).toBeLessThan(12)

        await field.press('Control+Enter')
        await expect(dialog.getByRole('alert')).toHaveText(WORDS[locale].noAnswer)
        await frames(dialog)
        await expect(field).toBeFocused()
        const refused = await caretAtEdge(field, 'start')
        const refusedRoom = await shownRoom(dialog)
        // The field is taller than what the refusal leaves: it cannot stand whole.
        expect(refused.height).toBeGreaterThan((refusedRoom?.lower ?? 0) - (refusedRoom?.top ?? 0))
        inSight(refused, refusedRoom, 'refused')

        await page.setViewportSize({ width, height: 320 })
        await frames(dialog)
        const shorter = await caretAtEdge(field, 'start')
        inSight(shorter, await shownRoom(dialog), 'shorter')
        await keep(info, `caret-${String(width)}-${locale}`, { before, refused, shorter })
      })

      test('the caret’s last line comes out from under a refusal', async ({ page }, info) => {
        const { dialog, release } = await openComposer(page, width, locale)
        release()
        const field = dialog.getByRole('textbox', { name: WORDS[locale].description, exact: true })
        await field.fill(LONG)
        await field.press('Control+End')
        await frames(dialog)
        const before = await caretAtEdge(field, 'end')
        await field.press('Control+Enter')
        await expect(dialog.getByRole('alert')).toHaveText(WORDS[locale].noAnswer)
        await frames(dialog)
        await expect(field).toBeFocused()
        const refused = await caretAtEdge(field, 'end')
        const room = await shownRoom(dialog)
        // Where the caret's line stood before, the refusal now stands.
        expect(room?.lower ?? Infinity).toBeLessThan(before.bottom)
        inSight(refused, room, 'refused')
        await keep(info, `caret-end-${String(width)}-${locale}`, { before, refused, room })
      })
    })

/** What «Split off a part» is called and its parts are named, in each language. */
const SPLIT = {
  'ru-RU': {
    more: 'Ещё',
    entry: 'Отделить часть…',
    dialog: 'Отделить часть',
    name: 'Название',
    create: 'Создать',
  },
  'en-US': {
    more: 'More',
    entry: 'Split off a part…',
    dialog: 'Split off a part',
    name: 'Title',
    create: 'Create',
  },
} as const

/** Presses Shift+Tab, a few times at most, until the focus is on `body` itself. */
async function backToBody(page: Page, body: Locator) {
  for (let press = 0; press < 3; press++) {
    await page.keyboard.press('Shift+Tab')
    if (await body.evaluate((node) => node === document.activeElement)) return
  }
}

for (const locale of ['ru-RU', 'en-US'] as const)
  test.describe(`«Split off a part» 1280×380 in ${locale}`, () => {
    test.use({ locale })

    test('the body focused while the create waits is not scrolled by a refusal or a shorter window', async ({
      page,
    }, info) => {
      const words = SPLIT[locale]
      await page.setViewportSize({ width: 1280, height: 380 })
      await installBackend(page, { space: goalSpace, card: placedCard })
      const { held, release } = holdBack()
      await page.route('**/api/planning/work-items', async (route) => {
        await held
        await route.fulfill({ status: 503, body: '' })
      })
      await page.goto(
        serializePlatformRoute({
          module_id: 'planning',
          scope: spaceScope,
          entity: planningWorkItemEntity(workItemRef),
        }),
      )
      await page.getByRole('button', { name: words.more, exact: true }).click()
      await page.getByRole('menuitem', { name: words.entry, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: words.dialog })
      await expect(dialog).toHaveCSS('transform', 'none')
      await dialog
        .getByRole('textbox', { name: words.name })
        .fill('Alert settings survive a restart')
      await dialog.locator('[data-step]').last().getByRole('checkbox').check()
      const create = dialog.getByRole('button', { name: words.create, exact: true })
      await create.focus()
      await page.keyboard.press('Enter')
      await expect(dialog.locator('form')).toHaveAttribute('aria-busy', 'true')
      const body = dialog.locator('[data-part="dialog-body"]')
      // Back from the foot: nothing in the body takes focus while it waits but the body itself.
      await backToBody(page, body)
      await expect(body).toBeFocused()
      await frames(dialog)
      const scrollTop = () => body.evaluate((node) => node.scrollTop)
      const before = await scrollTop()

      release()
      await expect(dialog.getByRole('alert')).toBeVisible()
      await frames(dialog)
      const refused = await scrollTop()
      await page.setViewportSize({ width: 1280, height: 320 })
      await frames(dialog)
      const shorter = await scrollTop()
      await keep(info, `split-body-${locale}`, { before, refused, shorter })
      await expect(body).toBeFocused()
      expect.soft(refused, 'refused').toBe(before)
      expect.soft(shorter, 'shorter').toBe(before)
    })
  })
