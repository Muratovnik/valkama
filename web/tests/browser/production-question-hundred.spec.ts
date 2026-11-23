/**
 * «Needs my answer» with a hundred blocks of one kind, and with more than one page of the list,
 * at the widths its layout changes at and at a phone's width in both languages: every block is
 * drawn and counted, the last one is reached by scrolling and answered, and a list of 250, past
 * the hundred the list once stopped at and past the 200 of one page, is read whole, the oldest
 * block in it.
 *
 * At 1280px it measures what the first screen of a hundred blocks costs after the press that
 * opens the dialog, and attaches the numbers to the test (`first-screen`). The wait must not show:
 * the list says it is loading only after 500ms, and a first screen that takes the page's main
 * thread that long fails. The bound is on that thread's own processor time, as DevTools reads it,
 * not on the wall: a machine busy with other work stretched the wall time past 500ms for a screen
 * that took under 200ms alone, and it stretches what the thread spent far less, since it only
 * slows the thread while it runs. The wall time is attached beside it. It is a timed test
 * (`timedChecks.ts`): it runs after the rest of the run, alone.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

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
 * frame after that, which is when it is on screen and `firstScreen` settles.
 */
function timeFirstScreen(page: Page) {
  return page.addInitScript(() => {
    const now = performance.now.bind(performance)
    const frame = requestAnimationFrame.bind(window)
    const marks: Record<string, number> = {}
    const screen: { shown?: () => void } = {}
    const firstScreen = new Promise<void>((resolve) => (screen.shown = resolve))
    Object.assign(window, { firstScreenMarks: marks, firstScreen })
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
      frame(() => {
        marks.onScreen = now()
        screen.shown?.()
      })
    }).observe(document, { childList: true, subtree: true })
  })
}

/**
 * Presses `rail` at its middle and answers with the processor time the page's main thread spent
 * from the press until the first screen is on (`firstScreen`), in milliseconds, as DevTools reads
 * it (`Performance.getMetrics`, `ThreadTime`): what the page's own work costs, which the time the
 * thread waits for the processor is not part of.
 *
 * Nothing of the test's own runs on that thread in between. The rail is found by its name before
 * the first reading, and the page has gone quiet after the card it left. The press, and the wait
 * for the screen, go to DevTools as Playwright's own would, but they are no calls of the test's,
 * so a recorded trace takes no snapshot of the page for them: one cost the thread about 100ms.
 */
async function pressForFirstScreen(page: Page, rail: Locator) {
  const box = await rail.boundingBox()
  if (!box) throw new Error('The rail has no «Needs my answer» on screen')
  const devtools = await page.context().newCDPSession(page)
  await devtools.send('Performance.enable')
  const threadTime = async () => {
    const { metrics } = await devtools.send('Performance.getMetrics')
    const seconds = metrics.find(({ name }) => name === 'ThreadTime')?.value
    if (seconds === undefined) throw new Error('DevTools reported no ThreadTime')
    return seconds * 1000
  }
  let before = await threadTime()
  // Quiet: under 5ms of the thread's time in a tenth of a second.
  await expect
    .poll(
      async () => {
        const last = before
        before = await threadTime()
        return before - last
      },
      { intervals: [100] },
    )
    .toBeLessThan(5)
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
  for (const type of ['mousePressed', 'mouseReleased'] as const)
    await devtools.send('Input.dispatchMouseEvent', { type, ...at, button: 'left', clickCount: 1 })
  await devtools.send('Runtime.evaluate', { expression: 'window.firstScreen', awaitPromise: true })
  const spent = (await threadTime()) - before
  await devtools.detach()
  return Math.round(spent)
}

async function openBlocks(
  page: Page,
  entries: InputRequestEntry[],
  {
    width,
    locale,
    press,
  }: { locale: string; width: number; press?: (rail: Locator) => Promise<unknown> },
) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  const opened = await openKinds(page, entries, width, { press })
  const waiting = opened.dialog.locator('[data-request-waiting]')
  await expect(waiting).toHaveCount(entries.length)
  return { ...opened, waiting }
}

test(
  'at 1280px the first screen of a hundred blocks comes before the wait would show',
  { tag: '@timed' },
  async ({ page }, testInfo) => {
    await timeFirstScreen(page)
    let cost = Number.NaN
    await openBlocks(page, blocks(100), {
      width: 1280,
      locale: 'en',
      press: async (rail) => {
        cost = await pressForFirstScreen(page, rail)
      },
    })
    const marks = await page.evaluate(
      () => (window as unknown as { firstScreenMarks: Record<string, number> }).firstScreenMarks,
    )
    const ms = (at = 0) => Math.round(at - (marks.press ?? 0))
    const body = `main thread's processor time, press to the frame after the first block: ${cost} ms; on the wall, press to the first block in the document: ${ms(marks.inDocument)} ms, to the frame after it: ${ms(marks.onScreen)} ms`
    await testInfo.attach('first-screen', { body, contentType: 'text/plain' })
    console.log(`first screen of 100 blocks at 1280px: ${body}`)
    expect(cost).toBeLessThan(500)
  },
)

for (const { width, locale } of CASES) {
  const words = WORDS[locale]

  test(`at ${width}px in ${locale} a hundred blocks are drawn, counted, scrolled to the last and answered there`, async ({
    page,
  }) => {
    const { dialog, record, requests, waiting } = await openBlocks(page, blocks(100), {
      width,
      locale,
    })
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
    const { dialog, record, requests } = await openBlocks(page, blocks(250), { width, locale })
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
