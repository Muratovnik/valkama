/**
 * The list of everything waiting, read as blocks of questions: each block's head stays at the
 * top of the list while its questions scroll, with the comment on the whole block in it and the
 * task's number as the way to the task, and a rail of short bars at the dialog's start edge goes
 * to any question, by the pointer and by the keys.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { REVIEW_PROMPT, reviewFields } from '../support/reviewQuestion.ts'
import { box } from './editorPage.ts'
import { asked, mixedField, openQuestion, routeField } from './questionBackend.ts'
import { test } from './test.ts'

const LIST = /^(?:Needs my answer|Ждут моего ответа)/u
const field = (id: string, label: string): InputRequestField => ({ ...routeField, id, label })
const BLOCKS = [
  { id: '88888888-8888-4888-8888-888888888881', title: 'First block', labels: ['Alpha', 'Beta'] },
  { id: '88888888-8888-4888-8888-888888888882', title: 'Second block', labels: ['Gamma'] },
  {
    id: '88888888-8888-4888-8888-888888888883',
    title: 'Third block',
    labels: ['Delta', 'Epsilon', 'Zeta'],
  },
]
const blocks = (): InputRequestEntry[] =>
  BLOCKS.map((block, index) =>
    asked({
      request_id: block.id,
      title: block.title,
      // The list puts the newest first: the first block is asked last.
      created_at: `2026-10-24T1${BLOCKS.length - index}:00:00Z`,
      fields: block.labels.map((label) => field(label.toLowerCase(), label)),
    }),
  )
const QUESTIONS = BLOCKS.flatMap((block) => block.labels)

async function openList(page: Page, entries: InputRequestEntry[], width: number) {
  await page.setViewportSize({ width, height: 844 })
  // A press on a bar scrolls at once, so where it lands is read when it has landed.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const opened = await openQuestion(page, entries)
  await page.keyboard.press('Escape')
  await expect(opened.drawer).toHaveCount(0)
  await page.getByRole('button', { name: LIST }).click()
  const dialog = page.getByRole('dialog', { name: LIST })
  await expect(dialog).toHaveCSS('transform', 'none')
  const scroller = dialog.locator('.dialog-frame-body')
  return { ...opened, dialog, scroller }
}

/** The block whose title this is. */
const block = (dialog: Locator, title: string) =>
  dialog
    .locator('.request-card')
    .filter({ has: dialog.page().getByRole('heading', { name: title }) })
const question = (scope: Locator, label: string) => scope.locator(`[data-rail-question="${label}"]`)

for (const width of [1280, 390] as const) {
  test(`a block's head stays at the top while its questions scroll, with its comment, at ${width}`, async ({
    page,
  }) => {
    const { dialog, scroller } = await openList(page, blocks(), width)
    const third = block(dialog, 'Third block')
    const head = third.locator('.request-header')
    // The comment on the whole block is named by the block, and no foot holds one.
    const press = head.getByRole('button', {
      name: 'Comment on the block of questions: Third block',
      exact: true,
    })
    await expect(press).toHaveAttribute('data-tooltip', 'Comment on the block of questions')
    await expect(dialog.locator('.request-foot .request-note-toggle')).toHaveCount(0)
    // The number in the head is the way to the task; no button says it again.
    await expect(head.getByRole('link', { name: /MAIN-264/u })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Open task' })).toHaveCount(0)

    const panel = await box(scroller)
    const last = question(third, 'Zeta')
    // Scrolled until the last question stands under where the head would have gone.
    await last.evaluate((node) => node.scrollIntoView({ block: 'start' }))
    await expect(head).toBeInViewport()
    const stuck = await box(head)
    expect(Math.abs(stuck.y - panel.y), 'the head at the very top of the list').toBeLessThan(1)
    // The press stays on the axis of the head's first line.
    const line = await box(head.locator('.request-context'))
    const glyph = await box(press)
    expect(Math.abs(glyph.y + glyph.height / 2 - (line.y + line.height / 2))).toBeLessThanOrEqual(1)
    // Pressed, it opens the comment at the end of the block, where focus goes.
    await press.click()
    await expect(
      third.getByRole('textbox', { name: 'Comment on the block of questions', exact: true }),
    ).toBeFocused()
  })
}

test('the next block’s head takes the place of the one before as its block comes up', async ({
  page,
}) => {
  const { dialog, scroller } = await openList(page, blocks(), 1280)
  const panel = await box(scroller)
  const first = block(dialog, 'First block').locator('.request-header')
  const third = block(dialog, 'Third block').locator('.request-header')
  await question(block(dialog, 'First block'), 'Beta').evaluate((node) =>
    node.scrollIntoView({ block: 'start' }),
  )
  const stuck = await box(first)
  expect(Math.abs(stuck.y - panel.y)).toBeLessThan(1)
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  const next = await box(third)
  expect(Math.abs(next.y - panel.y)).toBeLessThan(1)
  // The first block's head left with its block: it stands above the list, out of sight.
  const gone = await box(first)
  expect(gone.y + gone.height).toBeLessThanOrEqual(panel.y + 1)
})

test('a bar for each question at the start edge goes to it, under the head that sticks', async ({
  page,
}) => {
  const { dialog, scroller } = await openList(page, blocks(), 1280)
  const rail = dialog.getByRole('navigation', { name: 'Question navigation' })
  const bars = rail.getByRole('button')
  await expect(bars).toHaveCount(QUESTIONS.length)
  for (const [index, label] of QUESTIONS.entries()) {
    await expect(bars.nth(index)).toHaveAccessibleName(label)
    await expect(bars.nth(index)).toHaveAttribute('data-tooltip', label)
  }
  await expect(rail.getByRole('group', { name: 'Third block' }).getByRole('button')).toHaveCount(3)
  // In the start inset, left of the words, which stand where the dialog's head's words do.
  const edge = await box(rail)
  const words = await box(dialog.locator('.request-card').first())
  expect(edge.x + edge.width).toBeLessThanOrEqual(words.x + 0.5)
  for (const bar of await bars.all()) {
    const target = await box(bar)
    expect(target.width).toBeGreaterThanOrEqual(24)
    expect(target.height).toBeGreaterThanOrEqual(24)
  }
  await expect(bars.first()).toHaveAttribute('aria-current', 'location')

  const delta = bars.nth(QUESTIONS.indexOf('Delta'))
  await delta.click()
  await expect(delta).toHaveAttribute('aria-current', 'location')
  await expect(bars.first()).not.toHaveAttribute('aria-current')
  const third = block(dialog, 'Third block')
  const head = await box(third.locator('.request-header'))
  const landed = await box(question(third, 'Delta'))
  const panel = await box(scroller)
  expect(Math.abs(head.y - panel.y)).toBeLessThan(1)
  expect(landed.y, 'clear of the head').toBeGreaterThanOrEqual(head.y + head.height)
  expect(landed.y, 'right under it').toBeLessThanOrEqual(head.y + head.height + 16)
  // A press of the pointer leaves focus where it was.
  await expect(delta).toBeFocused()
})

test('the rail is one stop on Tab, the arrows walk it and Enter takes focus to the question', async ({
  page,
}) => {
  const { dialog } = await openList(page, blocks(), 1280)
  const bars = dialog.getByRole('navigation', { name: 'Question navigation' }).getByRole('button')
  await dialog.getByRole('button', { name: 'Close questions', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(bars.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(bars.nth(2)).toBeFocused()
  await page.keyboard.press('End')
  await expect(bars.last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(bars.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  const gamma = question(block(dialog, 'Second block'), 'Gamma')
  await expect(gamma.getByRole('radio').first()).toBeFocused()
  await expect(bars.nth(2)).toHaveAttribute('aria-current', 'location')
  // Back in the rail, the one stop is the question being read.
  await dialog.getByRole('button', { name: 'Close questions', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(bars.nth(2)).toBeFocused()
})

test('a phone-wide window draws no rail, and the inset it would stand in is the inset', async ({
  page,
}) => {
  const { dialog } = await openList(page, blocks(), 390)
  await expect(dialog.getByRole('navigation', { name: 'Question navigation' })).toBeHidden()
  const frame = await box(dialog.locator('.dialog-frame'))
  const card = await box(dialog.locator('.request-card').first())
  const title = await box(dialog.locator('.overlay-header-name'))
  expect(Math.abs(card.x - title.x)).toBeLessThanOrEqual(1)
  expect(card.x - frame.x).toBeGreaterThanOrEqual(15)
})

test('a review in the list keeps its count under the block’s head and its foot at the bottom', async ({
  page,
}) => {
  const { dialog, scroller } = await openList(
    page,
    [asked({ prompt: REVIEW_PROMPT, fields: reviewFields, title: 'Review of the checks' })],
    1280,
  )
  const card = dialog.locator('.request-card')
  await expect(card.locator('.request-point')).toHaveCount(18)
  // A review marks no field of its own: its titled groups are its questions.
  const bars = dialog.getByRole('navigation', { name: 'Question navigation' }).getByRole('button')
  expect(await bars.count()).toBeGreaterThan(1)
  const panel = await box(scroller)
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight * 0.5
  })
  const head = await box(card.locator('.request-header'))
  const count = await box(card.locator('.request-review-head'))
  const foot = await box(card.locator('footer.request-foot'))
  expect(Math.abs(head.y - panel.y)).toBeLessThan(1)
  expect(Math.abs(count.y - (head.y + head.height))).toBeLessThanOrEqual(1)
  expect(Math.abs(foot.y + foot.height - (panel.y + panel.height))).toBeLessThanOrEqual(1)
  // Nothing the keyboard reaches stands under any of them.
  await card.getByRole('button', { name: 'Accept recommended', exact: true }).focus()
  const covered: string[] = []
  for (const key of [
    ...Array.from({ length: 30 }, () => 'Tab'),
    ...Array.from({ length: 30 }, () => 'Shift+Tab'),
  ]) {
    await page.keyboard.press(key)
    // The browser's own scroll comes first; what moves focus clear of a stuck part, next.
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const under = await card.evaluate((root) => {
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || !root.contains(active)) return []
      const a = active.getBoundingClientRect()
      return [...root.querySelectorAll<HTMLElement>('[data-stuck-edge]')]
        .filter((edge) => !edge.contains(active) && !active.contains(edge))
        .filter((edge) => {
          const b = edge.getBoundingClientRect()
          return a.top < b.bottom && b.top < a.bottom
        })
        .map((edge) => edge.className)
    })
    covered.push(...under.map((edge) => `${key} under ${edge}`))
  }
  expect(covered).toEqual([])
})

const twin = (id: string, title: string) =>
  asked({ request_id: id, title, fields: [routeField, mixedField] })

test('two questions of one label in two blocks are two bars', async ({ page }) => {
  const { dialog } = await openList(
    page,
    [
      twin('99999999-9999-4999-8999-999999999991', 'One'),
      twin('99999999-9999-4999-8999-999999999992', 'Two'),
    ],
    1280,
  )
  const rail = dialog.getByRole('navigation', { name: 'Question navigation' })
  await expect(rail.getByRole('group')).toHaveCount(2)
  await expect(rail.getByRole('button', { name: 'Route', exact: true })).toHaveCount(2)
})
