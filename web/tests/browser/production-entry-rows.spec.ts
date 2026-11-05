/**
 * The rows of controls under a question and an entry, and the times written into their lines,
 * where the room runs short. The two answers of a question are one pair and wrap together, as
 * Cancel and Save do while an answer is changed; a form's buttons wrapped under its count stand
 * at its end, as every other form's do; and a time inside a sentence breaks around itself and
 * never inside, «05 нояб. 2026 г.,» at the end of one line and «23:47» starting the next.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openCard } from './editorPage.ts'
import { asked, openQuestion, send } from './questionBackend.ts'
import { test } from './test.ts'
import { root } from './threadFixtures.ts'

const topOf = (target: Locator) => target.evaluate((node) => node.getBoundingClientRect().top)

/** The lines a time is drawn on inside `line`, found by its day, year and clock. */
const timeLines = (line: Locator) =>
  line.evaluate((node) => {
    const text = node.textContent ?? ''
    const found = /\d{1,2}\s\S+\s\d{4}(?:\s\S+)?,?\s\d{1,2}:\d{2}/u.exec(text)
    if (!found) throw new Error(`No time in «${text}»`)
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let at = walker.nextNode(); at; at = walker.nextNode()) {
      const start = (at.textContent ?? '').indexOf(found[0])
      if (start < 0) continue
      const range = document.createRange()
      range.setStart(at, start)
      range.setEnd(at, start + found[0].length)
      const tops = [...range.getClientRects()].map((rect) => Math.round(rect.top))
      return new Set(tops).size
    }
    throw new Error('The time spans several nodes')
  })

async function inRussian(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width, height: 900 })
}

test('a send that failed keeps its two answers on one line beside Check status, at 1280', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const { card, requests } = await openQuestion(page, [asked()])
  await card.getByRole('radio', { name: 'Move them', exact: true }).click()
  requests.failNext(503)
  await send(card).click()
  await expect(card.getByRole('button', { name: 'Check status', exact: true })).toBeVisible()
  const wayOut = card.getByRole('button', { name: "Don't answer", exact: true })
  expect(Math.abs((await topOf(wayOut)) - (await topOf(send(card))))).toBeLessThanOrEqual(1)
})

test('ru: Cancel and Save of a change wrap together, at 390', async ({ page }) => {
  await inRussian(page, 390)
  const { card } = await openQuestion(page, [
    asked({ status: 'answered', answers: { route: 'move' }, resolved_at: '2026-10-24T12:00:00Z' }),
  ])
  await card.getByRole('button', { name: 'Изменить ответ', exact: true }).click()
  const cancel = card.getByRole('button', { name: 'Отмена', exact: true })
  const save = card.getByRole('button', { name: 'Сохранить изменение', exact: true })
  await expect(save).toBeVisible()
  expect(Math.abs((await topOf(cancel)) - (await topOf(save)))).toBeLessThanOrEqual(1)
})

test('ru: the steps form wraps its buttons to its end, at 390', async ({ page }) => {
  await inRussian(page, 390)
  const opened = await openCard(page)
  opened.backend.item.comments.push(root(1, 'Left:\n\n- one\n- two\n- three'))
  await page.reload()
  const entry = opened.drawer.locator('.thread-entry').filter({ hasText: 'Left:' })
  await entry.getByRole('button', { name: 'В шаги', exact: true }).click()
  const form = entry.locator('.steps-form')
  const add = form.getByRole('button', { name: /^Добавить/u })
  await expect(add).toBeVisible()
  const end = await form.evaluate((node) => {
    const box = node.getBoundingClientRect()
    return box.right - (Number.parseFloat(getComputedStyle(node).paddingInlineEnd) || 0)
  })
  const right = await add.evaluate((node) => node.getBoundingClientRect().right)
  expect(Math.abs(right - end)).toBeLessThanOrEqual(1)
})

test('ru: a time inside the line of a closed question and of a mark stays whole, at 390', async ({
  page,
}) => {
  await inRussian(page, 390)
  const opened = await openQuestion(page, [
    asked({
      status: 'declined',
      answered_by: 'worker-agent',
      by_person: false,
      resolved_at: '2026-10-24T12:00:00Z',
    }),
  ])
  opened.backend.item.comments.push(
    root(1, 'A thread that was settled.', {
      resolution: {
        at: '2026-10-24T12:30:00Z',
        by: 'reviewer-agent',
        by_person: false,
        text: 'Keep one run.',
      },
    }),
  )
  await page.reload()
  const closed = opened.card.locator('.request-closed')
  await expect(closed).toContainText('worker-agent')
  expect(await timeLines(closed)).toBe(1)
  const mark = opened.drawer.locator('.thread-entry').filter({ hasText: 'Keep one run.' })
  await expect(mark).toBeVisible()
  expect(await timeLines(mark.locator('.thread-mark'))).toBe(1)
})
