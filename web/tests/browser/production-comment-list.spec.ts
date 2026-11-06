/**
 * A list an agent put under its comment, read off the built page: it stands in the comment's
 * own sheet and not among the questions, ticking only ticks and one press sends, an answer can be
 * changed, and a closed task freezes it with what was ticked and not sent kept in sight.
 *
 * Where it stands is measured on what is drawn: the first line of the comment's text, every box
 * and every mark, the label's words and the comment glyph's strokes, in every state, in both
 * languages, at a desktop width and a phone's, and in a forced palette.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import {
  answersTap,
  boxes,
  LIST_LABEL,
  listEntry,
  measure,
  moveItem,
  openList,
  OPTIONS,
} from './commentListBackend.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

const WORDS = {
  en: {
    send: 'Send marks',
    change: 'Change',
    answerChange: 'Change answer',
    save: 'Save change',
    cancel: 'Cancel',
    note: 'Comment on the marks',
    ticked: (n: number) => `You ticked ${n} of ${OPTIONS}`,
    frozen: 'The task is closed: marks would reach no one. Reopen the task to tick them.',
    unsent: 'Not sent. This is what you had chosen:',
    strip: {
      marks: {
        ask: 'Discard the change to these marks?',
        confirm: 'Discard change to these marks',
      },
      answer: { ask: 'Discard the change to this answer?', confirm: 'Discard change' },
    },
  },
  ru: {
    send: 'Отправить отметки',
    change: 'Изменить',
    answerChange: 'Изменить ответ',
    save: 'Сохранить',
    cancel: 'Отмена',
    note: 'Комментарий к отметкам',
    ticked: (n: number) => `Вы отметили ${n} из ${OPTIONS}`,
    frozen: 'Задача закрыта: отметки не дошли бы ни до кого. Откройте задачу, чтобы отметить.',
    unsent: 'Не отправлено. Вот что вы выбрали:',
    strip: {
      marks: { ask: 'Отменить изменение отметок?', confirm: 'Отменить изменение отметок' },
      answer: { ask: 'Отменить изменение ответа?', confirm: 'Отменить изменение' },
    },
  },
}
type Words = (typeof WORDS)['en']

/** An answered question, as the sibling answer specs open one: changed from its answer. */
const ANSWERED: Parameters<typeof asked>[0] = {
  status: 'answered',
  answers: { route: 'move' },
  resolved_at: '2026-10-24T12:00:00Z',
}

const button = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true })
const tick = (list: Locator, label: string) => list.getByRole('checkbox', { name: label })

test('a list stands under its comment, ticks only tick, and one press sends them', async ({
  page,
}) => {
  const { drawer, list, requests } = await openList(page)
  const words = WORDS.en
  await expect(list).toBeVisible()
  // Not a question: nothing of it among the questions, and nothing waits for an answer.
  await expect(drawer.locator('.request-card')).toHaveCount(0)
  await expect(drawer.getByRole('button', { name: 'Waiting for an answer' })).toHaveCount(0)
  await expect(list.getByText(LIST_LABEL, { exact: true })).toBeVisible()
  await expect(boxes(list)).toHaveCount(OPTIONS)
  // Nobody waits on it, so it is not declined; the comment's own head names who wrote it.
  await expect(button(list, "Don't answer")).toHaveCount(0)
  await expect(list.locator('.meta-line')).toHaveCount(0)
  await expect(list.locator('.request-option').first()).toContainText('recommended')

  await tick(list, 'Widen the check').check()
  // The row's words are its press as much as the box is.
  await list.getByText('Split the guard', { exact: true }).click()
  await expect(tick(list, 'Split the guard')).toBeChecked()
  expect(requests.writes).toEqual([])

  await button(list, words.send).click()
  await expect(list).toContainText(words.ticked(2))
  expect(requests.writes).toHaveLength(1)
  expect(requests.writes[0]?.action).toBe('answer')
  expect(requests.writes[0]?.body.answers).toEqual({ items: ['a', 'c'] })
  await expect(boxes(list)).toHaveCount(0)
  await expect(list.locator('.request-option.is-chosen')).toHaveCount(2)
  await expect(drawer.getByRole('button', { name: 'Waiting for an answer' })).toHaveCount(0)
})

test('a change opens on what was sent, and a closed task freezes the list until it reopens', async ({
  page,
}) => {
  const opened = await openList(page)
  const { list, requests } = opened
  const words = WORDS.en
  await tick(list, 'Widen the check').check()
  await tick(list, 'Fix the docs').check()
  await button(list, words.send).click()
  await expect(list).toContainText(words.ticked(2))

  await button(list, words.change).click()
  await expect(tick(list, 'Widen the check')).toBeChecked()
  await expect(tick(list, 'Fix the docs')).toBeChecked()
  await expect(button(list, words.save)).toBeDisabled()
  await tick(list, 'Leave it for later').check()
  await button(list, words.save).click()
  await expect(list).toContainText(words.ticked(3))
  expect(requests.writes[1]?.action).toBe('change')
  expect(requests.writes[1]?.body.answers).toEqual({ items: ['a', 'b', 'e'] })

  await moveItem(opened, true)
  await expect(list).toContainText(words.frozen)
  await expect(list).toContainText(words.ticked(3))
  await expect(button(list, words.change)).toHaveCount(0)
  await expect(button(list, words.send)).toHaveCount(0)

  await moveItem(opened, false)
  await expect(list).not.toContainText(words.frozen)
  await button(list, words.change).click()
  await tick(list, 'Fix the docs').uncheck()
  await button(list, words.save).click()
  await expect(list).toContainText(words.ticked(2))
  expect(requests.writes[2]?.body.answers).toEqual({ items: ['a', 'e'] })
})

test('a tick not sent when the task closed stays in sight, and is there to send once it reopens', async ({
  page,
}) => {
  const opened = await openList(page)
  const { list, requests } = opened
  const words = WORDS.en
  await tick(list, 'Split the guard').check()
  await moveItem(opened, true, { status: 'expired', expired_reason: 'task_closed' })
  await expect(list).toContainText(words.frozen)
  await expect(list).toContainText(words.unsent)
  await expect(list).toContainText(`${LIST_LABEL}: Split the guard`)
  await expect(boxes(list)).toHaveCount(0)
  await expect(button(list, words.send)).toHaveCount(0)
  expect(requests.writes).toEqual([])

  await moveItem(opened, false, { status: 'pending', expired_reason: null })
  await expect(tick(list, 'Split the guard')).toBeChecked()
  await tick(list, 'Widen the check').check()
  await button(list, words.send).click()
  await expect(list).toContainText(words.ticked(2))
  expect(requests.writes).toHaveLength(1)
  expect(requests.writes[0]?.body.answers).toEqual({ items: ['c', 'a'] })
})

/** A sent list, with one mark ticked, from which the test changes it. */
async function sentList(page: Page, words: Words) {
  const opened = await openList(page)
  await tick(opened.list, 'Widen the check').check()
  await button(opened.list, words.send).click()
  await expect(opened.list).toContainText(words.ticked(1))
  return opened
}

/** Cancels a change with a mark ticked in it, which asks in the strip before it throws it away. */
async function cancelChangedMarks(list: Locator, words: Words) {
  await button(list, words.change).click()
  await tick(list, 'Split the guard').check()
  await button(list, words.cancel).click()
}

/** A question's answer changed and cancelled with something changed in it: the strip asks. */
async function cancelChangedAnswer(page: Page, words: Words) {
  const { card } = await openQuestion(page, [asked(ANSWERED)])
  await card.getByRole('button', { name: words.answerChange, exact: true }).click()
  await card.getByRole('radio', { name: 'Keep the comments', exact: true }).check()
  await card.getByRole('button', { name: words.cancel, exact: true }).click()
  return card
}

test('a cancelled change to a list asks about the marks, not the answer', async ({ page }) => {
  const { list } = await sentList(page, WORDS.en)
  await cancelChangedMarks(list, WORDS.en)
  await expect(list.getByText(WORDS.en.strip.marks.ask, { exact: true })).toBeVisible()
  await expect(button(list, WORDS.en.strip.marks.confirm)).toBeVisible()
  await expect(list.getByText(WORDS.en.strip.answer.ask, { exact: true })).toHaveCount(0)
})

test('a cancelled change to a question asks about the answer', async ({ page }) => {
  const card = await cancelChangedAnswer(page, WORDS.en)
  await expect(card.getByText(WORDS.en.strip.answer.ask, { exact: true })).toBeVisible()
  await expect(button(card, WORDS.en.strip.answer.confirm)).toBeVisible()
  await expect(card.getByText(WORDS.en.strip.marks.ask, { exact: true })).toHaveCount(0)
})

/**
 * The gaps between the ring round a focused list and the first and last words of the list, on
 * each side. The ring's inner edge stands `outline-offset` outside the box, and the words lie
 * inside the box, so the gap on a side is how far the words stand from that edge.
 */
const ringGaps = (list: Locator) =>
  list.evaluate((node) => {
    // A line laid out wider than the box that clips it (a folded description, an ellipsis) is
    // drawn only as far as that box shows, so each rect is cut to every clipping box between the
    // text and the list.
    const shownOf = (text: Node, rect: DOMRect) => {
      let shown = { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top }
      for (
        let parent = text.parentElement;
        parent && node.contains(parent);
        parent = parent.parentElement
      ) {
        const { overflowX, overflowY } = getComputedStyle(parent)
        if (overflowX === 'visible' && overflowY === 'visible') continue
        const frame = parent.getBoundingClientRect()
        shown = {
          bottom: Math.min(shown.bottom, frame.bottom),
          left: Math.max(shown.left, frame.left),
          right: Math.min(shown.right, frame.right),
          top: Math.max(shown.top, frame.top),
        }
      }
      return shown
    }
    const drawn: { bottom: number; left: number; right: number; top: number }[] = []
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(text)
      for (const rect of range.getClientRects()) {
        const shown = shownOf(text, rect)
        if (shown.right > shown.left && shown.bottom > shown.top) drawn.push(shown)
      }
    }
    const box = node.getBoundingClientRect()
    const style = getComputedStyle(node)
    const offset = Number.parseFloat(style.outlineOffset)
    const space = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--space-1'),
    )
    const words = {
      left: Math.min(...drawn.map((rect) => rect.left)),
      right: Math.max(...drawn.map((rect) => rect.right)),
      top: Math.min(...drawn.map((rect) => rect.top)),
      bottom: Math.max(...drawn.map((rect) => rect.bottom)),
    }
    return {
      style: style.outlineStyle,
      space,
      gaps: {
        top: words.top - (box.top - offset),
        left: words.left - (box.left - offset),
        right: box.right + offset - words.right,
        bottom: box.bottom + offset - words.bottom,
      },
    }
  })

/** A focused list's ring keeps `--space-1` from its words on every side. Half a pixel is rounding. */
async function expectRingClear(list: Locator) {
  const ring = await ringGaps(list)
  expect(ring.style, 'the ring is drawn for the keyboard or a landing').toBe('solid')
  for (const [side, gap] of Object.entries(ring.gaps))
    expect
      .soft(gap, `the ring's gap to the words on the ${side}`)
      .toBeGreaterThanOrEqual(ring.space - 0.5)
}

for (const width of [1280, 390]) {
  test(`a list that takes focus after a send rings clear of its words at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { list } = await sentList(page, WORDS.en)
    await expect(list).toBeFocused()
    await expectRingClear(list)
  })
}

/** Within a pixel: a drawn edge is a fraction of one off its box's by antialiasing alone. */
function expectOn(edges: readonly (number | null)[], at: number, what: string) {
  for (const [index, edge] of edges.entries())
    expect(Math.abs((edge ?? Number.NaN) - at), `${what} ${index + 1}`).toBeLessThanOrEqual(1)
}

/**
 * Every edge that stands on the comment text's in one state: the list, its label, every box or
 * mark and the comment glyph; every button at the row's end, a pair on one line; and at a
 * phone's width every control with no words of its own taking a tap across 44 px.
 */
async function expectEdges(page: Page, article: Locator, list: Locator) {
  const at = await measure(article)
  expectOn([at.list.left, at.label], at.text, 'the list and its label')
  expectOn([...at.boxes, ...at.marks], at.text, 'a box or its mark')
  if (at.glyph !== null) expectOn([at.glyph], at.text, 'the comment glyph')
  expectOn(at.ends, at.list.right, 'a button at the row end')
  expect(new Set(at.pair).size, 'the pair on one line').toBeLessThanOrEqual(1)
  if ((page.viewportSize()?.width ?? 0) > 400) return
  const toggles = list.locator('.request-note-toggle, .request-option-toggle')
  for (const toggle of await toggles.all())
    expect(await answersTap(toggle), 'a 44 px tap').toBe(true)
}

async function everyState(page: Page, words: Words) {
  const opened = await openList(page, [listEntry()])
  const { article, list } = opened
  await expectEdges(page, article, list)
  // A row is its press, words included, at a phone's width as at a desktop's.
  await list.getByText('Leave it for later', { exact: true }).click()
  await expect(tick(list, 'Leave it for later')).toBeChecked()
  await button(list, words.send).click()
  await expect(list).toContainText(words.ticked(1))
  await expectEdges(page, article, list)
  await button(list, words.change).click()
  await expect(button(list, words.cancel)).toBeVisible()
  await tick(list, 'Split the guard').check()
  await expectEdges(page, article, list)
  await button(list, words.save).click()
  await moveItem(opened, true)
  await expect(list).toContainText(words.frozen)
  await expectEdges(page, article, list)
  return list
}

for (const width of [1280, 390]) {
  for (const forced of [false, true]) {
    test(`every state stands on the comment's text at ${width}${forced ? ', forced colours' : ''}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: forced ? 'active' : 'none' })
      // Frozen, there is nothing left to tick.
      await expect(boxes(await everyState(page, WORDS.en))).toHaveCount(0)
    })
  }
}

test.describe('in Russian', () => {
  test.use({ locale: 'ru-RU' })

  test('a cancelled change to a list asks about the marks, not the answer', async ({ page }) => {
    const { list } = await sentList(page, WORDS.ru)
    await cancelChangedMarks(list, WORDS.ru)
    await expect(list.getByText(WORDS.ru.strip.marks.ask, { exact: true })).toBeVisible()
    await expect(button(list, WORDS.ru.strip.marks.confirm)).toBeVisible()
    await expect(list.getByText(WORDS.ru.strip.answer.ask, { exact: true })).toHaveCount(0)
  })

  test('a cancelled change to a question asks about the answer', async ({ page }) => {
    const card = await cancelChangedAnswer(page, WORDS.ru)
    await expect(card.getByText(WORDS.ru.strip.answer.ask, { exact: true })).toBeVisible()
    await expect(button(card, WORDS.ru.strip.answer.confirm)).toBeVisible()
    await expect(card.getByText(WORDS.ru.strip.marks.ask, { exact: true })).toHaveCount(0)
  })

  for (const width of [1280, 390]) {
    test(`every state stands on the comment's text at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(boxes(await everyState(page, WORDS.ru))).toHaveCount(0)
    })
  }
})
