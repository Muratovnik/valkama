/**
 * «Needs my answer» with a hundred blocks of one kind, and with more than one page of the list,
 * at the widths its layout changes at and at a phone's width in both languages: every block is
 * drawn and counted, the last one is reached by scrolling and answered, and a list of 250, past
 * the hundred the list once stopped at and past the 200 of one page, is read whole, the oldest
 * block in it.
 *
 * At 1280px it measures how long the first screen of a hundred blocks takes after the press that
 * opens the dialog, and attaches the number to the test (`first-screen`). The wait must not show:
 * the list says it is loading only after 500ms, and a first screen later than that fails.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { InputRequestEntry } from '@/shared/api/inputRequestModel.ts'

import { asked } from './questionBackend.ts'
import { openKinds } from './questionKindsPage.ts'
import { test } from './test.ts'

const WORDS = {
  en: { send: 'Send', answered: 'You answered', place: (n: number) => `Question 1 of ${n}` },
  ru: { send: 'Отправить', answered: 'Вы ответили', place: (n: number) => `Вопрос 1 из ${n}` },
} as const

const CASES = [
  { width: 1280, locale: 'en' },
  { width: 620, locale: 'en' },
  { width: 390, locale: 'en' },
  { width: 390, locale: 'ru' },
] as const

const id = (index: number) => `66666666-6666-4666-8666-${String(index + 1).padStart(12, '0')}`
/** Blocks «Block 001» and on, newest first, each one choice the agent recommends an option in. */
const blocks = (count: number): InputRequestEntry[] =>
  Array.from({ length: count }, (_, index) =>
    asked({
      request_id: id(index),
      prompt: `Block ${String(index + 1).padStart(3, '0')}`,
      created_at: new Date(Date.UTC(2026, 9, 24, 10, 0) - index * 60_000).toISOString(),
    }),
  )

/**
 * Notes, with the page's own clock taken before the test's replaces it, when the press on the
 * rail's «Needs my answer» lands, when the first block of the list is in the document, and the
 * frame after that, which is when it is on screen.
 */
function timeFirstScreen(page: Page) {
  return page.addInitScript(() => {
    const now = performance.now.bind(performance)
    const frame = requestAnimationFrame.bind(window)
    const marks: Record<string, number> = {}
    Object.assign(window, { firstScreenMarks: marks })
    document.addEventListener(
      'click',
      (event) => {
        const pressed = (event.target as Element | null)?.closest('button')
        if (/^(?:Needs my answer|Ждут моего ответа)/u.test(pressed?.textContent?.trim() ?? ''))
          marks.press = now()
      },
      { capture: true },
    )
    new MutationObserver(() => {
      if (marks.press === undefined || marks.inDocument !== undefined) return
      if (!document.querySelector('[role="dialog"] [data-request-waiting]')) return
      marks.inDocument = now()
      frame(() => (marks.onScreen = now()))
    }).observe(document, { childList: true, subtree: true })
  })
}

async function openBlocks(page: Page, entries: InputRequestEntry[], width: number, locale: string) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  const opened = await openKinds(page, entries, width)
  const waiting = opened.dialog.locator('[data-request-waiting]')
  await expect(waiting).toHaveCount(entries.length)
  return { ...opened, waiting }
}

test('at 1280px the first screen of a hundred blocks comes before the wait would show', async ({
  page,
}, testInfo) => {
  await timeFirstScreen(page)
  await openBlocks(page, blocks(100), 1280, 'en')
  await expect
    .poll(() => page.evaluate(() => (window as { firstScreenMarks?: object }).firstScreenMarks))
    .toHaveProperty('onScreen')
  const marks = await page.evaluate(
    () => (window as unknown as { firstScreenMarks: Record<string, number> }).firstScreenMarks,
  )
  const ms = (at = 0) => Math.round(at - (marks.press ?? 0))
  const body = `press to the first block in the document: ${ms(marks.inDocument)} ms; to the frame after it: ${ms(marks.onScreen)} ms`
  await testInfo.attach('first-screen', { body, contentType: 'text/plain' })
  console.log(`first screen of 100 blocks at 1280px: ${body}`)
  expect(ms(marks.onScreen)).toBeLessThan(500)
})

for (const { width, locale } of CASES) {
  const words = WORDS[locale]

  test(`at ${width}px in ${locale} a hundred blocks are drawn, counted, scrolled to the last and answered there`, async ({
    page,
  }) => {
    const { dialog, record, requests, waiting } = await openBlocks(page, blocks(100), width, locale)
    await expect(dialog.locator('.request-navigator-now')).toHaveText(words.place(100))

    const last = record('Block 100')
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
    await last.getByRole('radio', { name: 'Keep the comments', exact: true }).check()
    await last.getByRole('button', { name: words.send, exact: true }).click()
    await expect(last.locator('.request-state')).toContainText(words.answered)
    expect(requests.writes.map((write) => [write.body.id, write.body.answers])).toEqual([
      [id(99), { route: 'keep' }],
    ])
    await expect(waiting).toHaveCount(99)
  })

  test(`at ${width}px in ${locale} a list of 250 is read past one page, the oldest block in it`, async ({
    page,
  }) => {
    const { dialog, record, requests } = await openBlocks(page, blocks(250), width, locale)
    await expect(dialog.locator('.request-navigator-now')).toHaveText(words.place(250))
    // Two pages, of the most the server gives at once.
    expect(requests.reads.filter((search) => search.includes('status=pending'))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('limit=200'),
        expect.stringContaining('offset=200'),
      ]),
    )
    const oldest = record('Block 250')
    await oldest.scrollIntoViewIfNeeded()
    await expect(oldest).toBeInViewport()
    await expect(oldest.getByRole('radio')).toHaveCount(3)
  })
}
