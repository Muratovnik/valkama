/**
 * The way through «Needs my answer» in the dialog's head: «Question N of M», M counting the
 * blocks still waiting and N the one being read, and the steps to the one before and after,
 * which bring that block's head up to the top of the list.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { box } from './editorPage.ts'
import { asked, openQuestion, routeField } from './questionBackend.ts'
import { test } from './test.ts'

const POLL = 30_000
const WORDS = {
  en: { group: 'Question navigation', place: 'Question', of: 'of' },
  ru: { group: 'Навигация по вопросам', place: 'Вопрос', of: 'из' },
} as const
type Locale = keyof typeof WORDS
const field = (id: string, label: string): InputRequestField => ({ ...routeField, id, label })
const id = (index: number) => `66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}`
/** Blocks named «Block 1» and on, the first on top: the list puts the newest first. */
const blocks = (count: number, fields = 2): InputRequestEntry[] =>
  Array.from({ length: count }, (_, index) =>
    asked({
      request_id: id(index),
      title: `Block ${index + 1}`,
      created_at: new Date(Date.UTC(2026, 9, 24, 10, 0) - index * 60_000).toISOString(),
      fields: Array.from({ length: fields }, (_, at) =>
        field(`f${at}`, `Field ${index + 1}.${at}`),
      ),
    }),
  )

async function openList(page: Page, entries: InputRequestEntry[], width = 1280, locale?: Locale) {
  await page.setViewportSize({ width, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (locale)
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.clock.install()
  const opened = await openQuestion(page, entries)
  await page.keyboard.press('Escape')
  await expect(opened.drawer).toHaveCount(0)
  await page.getByRole('button', { name: /^(?:Needs my answer|Ждут моего ответа)/u }).click()
  const dialog = page.getByRole('dialog', { name: /^(?:Needs my answer|Ждут моего ответа)$/u })
  await expect(dialog).toHaveCSS('transform', 'none')
  const words = WORDS[locale ?? 'en']
  const group = dialog.getByRole('group', { name: words.group })
  const [count, up, down] = await group.getByRole('button').all()
  if (!count || !up || !down) throw new Error('no way through the list')
  // What it says, apart from the room it keeps for its widest number, which no one reads.
  const place = count.locator('.request-navigator-now')
  await page.evaluate(() => document.fonts.ready)
  return {
    ...opened,
    dialog,
    group,
    count,
    place,
    up,
    down,
    words,
    scroller: dialog.locator('.dialog-frame-body'),
  }
}

/** Two frames, for the count to read where the list stands after a change. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
const block = (dialog: Locator, title: string) =>
  dialog
    .locator('.request-card')
    .filter({ has: dialog.page().getByRole('heading', { name: title }) })

/** How many lines the words of an element stand on, read off their text's own boxes. */
const lines = (locator: Locator) =>
  locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
  })

/** Whether the head of this block stands at the very top of the list. */
async function onTop(dialog: Locator, scroller: Locator, title: string) {
  const head = await box(block(dialog, title).locator('.request-header'))
  const panel = await box(scroller)
  return Math.abs(head.y - panel.y) < 1
}

/** The vertical middles of these, which stand on one line when they agree. */
const middles = (controls: Locator[]) =>
  Promise.all(
    controls.map(async (control) => {
      const at = await box(control)
      return at.y + at.height / 2
    }),
  )
const spread = (values: number[]) => Math.max(...values) - Math.min(...values)

/**
 * The points 21px from the middle of this control, across and down, that miss it: a 44px target
 * less the half pixel hit testing rounds, where two targets meet edge to edge.
 */
const missesAcross44 = (control: Locator) =>
  control.evaluate((element) => {
    const at = element.getBoundingClientRect()
    const x = at.left + at.width / 2
    const y = at.top + at.height / 2
    const points = [
      [x - 21, y],
      [x + 21, y],
      [x, y - 21],
      [x, y + 21],
    ] as const
    return points
      .filter(([px, py]) => !element.contains(document.elementFromPoint(px, py)))
      .map(([px, py]) => `${px - x},${py - y} on ${document.elementFromPoint(px, py)?.className}`)
  })

for (const locale of ['en', 'ru'] as const) {
  for (const width of [1280, 390] as const) {
    test(`the count and both steps stand on one line and keep their place as a number grows, ${locale} at ${width}`, async ({
      page,
    }) => {
      const { group, count, place, up, down, words, requests } = await openList(
        page,
        blocks(10, 1),
        width,
        locale,
      )
      await page.mouse.move(0, 0)
      await expect(place).toHaveText(`${words.place} 1 ${words.of} 10`)
      // Named by what it says alone: the room kept for a wider number is not read out.
      await expect(count).toHaveAccessibleName(`${words.place} 1 ${words.of} 10`)
      // One line: the words on one, and the three on the axis of that line.
      expect(await lines(place)).toBe(1)
      expect(spread(await middles([count, up, down]))).toBeLessThan(1)
      const where = async () => ({
        group: await box(group),
        up: await box(up),
        down: await box(down),
        count: await box(count),
      })
      const before = await where()
      // N gains a digit.
      await down.press('End')
      await expect(place).toHaveText(`${words.place} 10 ${words.of} 10`)
      expect(await where()).toEqual(before)
      // M loses one, as a block answered in another window leaves the next read.
      requests.settle(id(3), { status: 'answered', answers: { f0: 'move' }, answered_by: 'user' })
      await page.clock.runFor(POLL)
      await expect(place).toHaveText(`${words.place} 9 ${words.of} 9`)
      expect(await where()).toEqual(before)
      expect(await lines(place)).toBe(1)
    })
  }

  test(`under a phone's width each of the three answers across 44px, ${locale}`, async ({
    page,
  }) => {
    const { count, up, down } = await openList(page, blocks(3, 1), 390, locale)
    await page.mouse.move(0, 0)
    for (const control of [count, up, down]) expect(await missesAcross44(control)).toEqual([])
  })
}

test('in a wide head the count and the steps stand on the title’s line, beside the way out', async ({
  page,
}) => {
  const { dialog, count, up, down } = await openList(page, blocks(3, 1))
  const close = dialog.locator('.overlay-header-close')
  expect(spread(await middles([count, up, down, close]))).toBeLessThan(1)
})

test('the steps bring the next and the previous block up under the head, and say which it is', async ({
  page,
}) => {
  const { dialog, count, place, up, down, scroller } = await openList(page, blocks(5))
  await expect(place).toHaveText('Question 1 of 5')
  await down.click()
  await settle(page)
  await expect(place).toHaveText('Question 2 of 5')
  expect(await onTop(dialog, scroller, 'Block 2')).toBe(true)
  // Pressed again where it stands, it goes on: nothing rose under it.
  await down.click()
  await settle(page)
  await expect(place).toHaveText('Question 3 of 5')
  expect(await onTop(dialog, scroller, 'Block 3')).toBe(true)
  await up.click()
  await settle(page)
  await expect(place).toHaveText('Question 2 of 5')
  expect(await onTop(dialog, scroller, 'Block 2')).toBe(true)
  await expect(up).toBeFocused()
  // The keys walk from any of the three, and focus stays where it is.
  await page.keyboard.press('ArrowDown')
  await settle(page)
  await expect(place).toHaveText('Question 3 of 5')
  expect(await onTop(dialog, scroller, 'Block 3')).toBe(true)
  await page.keyboard.press('Home')
  await settle(page)
  await expect(place).toHaveText('Question 1 of 5')
  expect(await onTop(dialog, scroller, 'Block 1')).toBe(true)
  await page.keyboard.press('End')
  await settle(page)
  await expect(place).toHaveText('Question 5 of 5')
  await expect(block(dialog, 'Block 5').locator('.request-header')).toBeInViewport()
  await page.keyboard.press('ArrowUp')
  await settle(page)
  await expect(place).toHaveText('Question 4 of 5')
  await expect(up).toBeFocused()
  // The count goes to where the block being read is answered.
  await count.press('Enter')
  await expect(block(dialog, 'Block 4').getByRole('radio').first()).toBeFocused()
})

test('the count follows the block whose head stands at the top as the list scrolls', async ({
  page,
}) => {
  const { dialog, place, scroller } = await openList(page, blocks(4))
  for (const title of ['Block 2', 'Block 3', 'Block 1']) {
    await block(dialog, title).evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await settle(page)
    await expect(place).toHaveText(`Question ${title.at(-1)} of 4`)
  }
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await settle(page)
  await expect(place).toHaveText('Question 4 of 4')
})

test('no rail of bars is left at the start edge', async ({ page }) => {
  const { dialog } = await openList(page, blocks(3))
  await expect(dialog.getByRole('navigation')).toHaveCount(0)
  await expect(
    dialog.locator('[data-rail-question], [data-rail-block], .request-rail'),
  ).toHaveCount(0)
  // The list's words start where the head's do, with nothing standing in the inset.
  const title = await box(dialog.locator('.overlay-header-name'))
  const card = await box(dialog.locator('.request-card').first())
  expect(Math.abs(card.x - title.x)).toBeLessThanOrEqual(1)
})
