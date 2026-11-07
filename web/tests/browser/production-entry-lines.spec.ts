/**
 * The quiet lines of a card's talk, read off the built page in both languages from a phone's
 * width to a laptop's, by the words each line draws.
 *
 * A question's answer says who gave it in a phrase, «Answered by agent kolo». The phrase is one
 * unit: the time keeps its line only beside the whole of it. On the 14ch a name is owed it broke
 * inside itself beside the time, «Answered by agent» over «kolo», and at ru 390 inside the name.
 *
 * A thread's mark says who resolved it, when and the decision, a dot between. A line of it ends
 * and starts with a fact, never a dot, and the decision shares the date's line only whole: one
 * run of text broke at 320 after «Разобрано · вы ·», and «Moved» stood beside the date.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { frames } from './frames.ts'
import { asked, openQuestion, routeField } from './questionBackend.ts'
import { test } from './test.ts'
import { drawnLines, expectUnitHeld } from './textLines.ts'
import { SETTLED, talkedOn } from './threadFixtures.ts'

type Locale = 'en' | 'ru'

const ANSWERED = '44444444-4444-4444-8444-444444444451'
const UNPROVEN = '44444444-4444-4444-8444-444444444452'

/** An answer an agent's call gave, and one from before calls were recorded, signed «user». */
const answers = [
  asked({
    request_id: ANSWERED,
    prompt: 'Answered by an agent',
    fields: [routeField],
    status: 'answered',
    answers: { route: 'keep' },
    answered_by: 'retrospective-reviewer (session 019a2b3c-4d5e-7f00-8a9b-0c1d2e3f4a5b)',
    by_person: false,
    resolved_at: '2026-10-24T10:30:00Z',
  }),
  asked({
    request_id: UNPROVEN,
    prompt: 'Answered before calls were recorded',
    fields: [routeField],
    status: 'answered',
    answers: { route: 'move' },
    answered_by: 'user',
    by_person: null,
    resolved_at: '2026-10-24T09:30:00Z',
  }),
]

async function openAnswers(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
  const opened = await openQuestion(page, answers)
  await expect(opened.drawer).toHaveCSS('transform', 'none')
  await expect(opened.card.locator('.request-reply-meta')).toHaveCount(2)
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  await frames(opened.drawer)
  return opened
}

const WORDS = {
  en: { agent: 'Answered by agent retrospective-reviewer', unproven: 'Answered by user' },
  ru: { agent: 'Ответил агент retrospective-reviewer', unproven: 'Ответил: user' },
} as const

for (const locale of ['en', 'ru'] as const) {
  // A name is only what a caller signed; «agent» is what the server proved of the call.
  test(`${locale}: an answer with no call behind it is not said to be an agent's`, async ({
    page,
  }) => {
    const { card } = await openAnswers(page, locale, 1280)
    const head = (prompt: string) =>
      card.filter({ hasText: prompt }).locator('.request-reply-meta .meta-who')
    await expect(head('Answered by an agent')).toHaveText(WORDS[locale].agent)
    await expect(head('Answered before calls')).toHaveText(WORDS[locale].unproven)
  })

  for (const width of [320, 390, 430, 1280])
    test(`${locale} at ${width}: an answer's phrase of who stays whole, the time beside it or under it`, async ({
      page,
    }) => {
      const { card } = await openAnswers(page, locale, width)
      const places = []
      for (const head of await card.locator('.request-reply-meta').all())
        places.push(
          await expectUnitHeld(head, `${locale} at ${width}: ${await head.textContent()}`),
        )
      expect(places).toHaveLength(2)
    })
}

async function openMark(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
  const opened = await openQuestion(page, [])
  opened.backend.item.comments.push(...talkedOn())
  await page.reload()
  const mark = opened.drawer
    .locator('.thread-entry')
    .filter({ hasText: SETTLED })
    .locator('.entry-head')
    .first()
  await expect(mark).toContainText(SETTLED)
  await page.evaluate(() => document.fonts.ready)
  await frames(mark)
  return mark
}

/** The decision shares a line with what comes before it only whole. */
const decisionApart = (lines: readonly string[]) =>
  lines.filter(
    (line) => line.includes('Moved') && !line.startsWith('Moved') && !line.includes(SETTLED),
  )

for (const locale of ['en', 'ru'] as const)
  for (const width of [320, 390, 1280])
    test(`${locale} at ${width}: a thread's mark breaks between its facts, no dot at a line's end`, async ({
      page,
    }) => {
      const mark = await openMark(page, locale, width)
      const words = await mark.locator('p').first().textContent()
      const drawn = await drawnLines(mark, 'p')
      const lines = drawn.map((line) => line.text)
      const where = `${locale} at ${width}: ${JSON.stringify(lines)}`
      expect(
        lines.filter((line) => /^·|·$/u.test(line)),
        where,
      ).toEqual([])
      expect(decisionApart(lines), where).toEqual([])
      // The words read as written, the dots included.
      expect(words, where).toMatch(
        new RegExp(`^(Resolved|Разобрано) · (you|вы) · .+ · ${SETTLED}$`, 'u'),
      )
    })
