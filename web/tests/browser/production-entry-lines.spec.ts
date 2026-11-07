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
 * run of text broke at 320 after «Разобрано · вы ·», and «Moved» stood beside the date. The dots
 * are read where they are seen, a box that clips them taken into account, since each fact's dot
 * is drawn before it and only the line's clip hides the one at a line's start. A fact wider than
 * the line wraps inside itself: kept on one line, a long name was cut where the line clips. The
 * mark reads and copies as the one line of text it was, « · » between the facts.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { frames } from './frames.ts'
import { asked, openQuestion, routeField } from './questionBackend.ts'
import { test } from './test.ts'
import { expectUnitHeld, seenLines } from './textLines.ts'
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

/** The card open on its talk, the settled thread resolved by `by` where it is given. */
async function openMark(page: Page, locale: Locale, width: number, by?: string) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
  const opened = await openQuestion(page, [])
  const talk = talkedOn()
  const settled = talk.find((row) => row.resolution?.text === SETTLED)?.resolution
  if (by && settled) Object.assign(settled, { by, by_person: false })
  opened.backend.item.comments.push(...talk)
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

/** The lines a mark is seen on, and what its line clips away other than dots. */
async function markSeen(mark: Locator) {
  const { hidden, lines } = await seenLines(mark, 'p')
  return { cut: hidden.replaceAll(/[\s·]/gu, ''), lines: lines.map((line) => line.text) }
}

/** The mark's text as a reader and a copy have it: its rendered text and a selection of it. */
const markRead = (mark: Locator) =>
  mark
    .locator('p')
    .first()
    .evaluate((line: HTMLElement) => {
      const selection = getSelection()
      selection?.selectAllChildren(line)
      const copied = selection?.toString() ?? ''
      selection?.removeAllRanges()
      // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- what is rendered is checked
      return { copied, rendered: line.innerText }
    })

for (const locale of ['en', 'ru'] as const)
  for (const width of [320, 390, 1280])
    test(`${locale} at ${width}: a thread's mark breaks between its facts, no dot at a line's end`, async ({
      page,
    }) => {
      const mark = await openMark(page, locale, width)
      const words = await mark.locator('p').first().textContent()
      const { cut, lines } = await markSeen(mark)
      const where = `${locale} at ${width}: ${JSON.stringify(lines)}`
      expect(
        lines.filter((line) => /^·|·$/u.test(line)),
        where,
      ).toEqual([])
      expect(cut, `${where}: cut away`).toBe('')
      expect(decisionApart(lines), where).toEqual([])
      // The words read and copy as written, the dots included, on one line.
      const written = new RegExp(`^(Resolved|Разобрано) · (you|вы) · [^\n]+ · ${SETTLED}$`, 'u')
      expect(words, where).toMatch(written)
      const { copied, rendered } = await markRead(mark)
      expect(rendered, `${where}: its text`).toMatch(written)
      expect(copied, `${where}: a copy`).toMatch(written)
    })

/** A name a little wider than a phone's line, and one wider than most lines. */
const LONG = 'retrospective-reviewer-of-exports'
const LONGEST = `${LONG}-and-of-the-step-claims-they-leaves`

for (const [by, widths] of [
  [LONG, [320, 330]],
  [LONGEST, [320, 390, 570]],
] as const)
  for (const width of widths)
    test(`at ${width}: a resolver's name of ${by.length} letters wraps inside itself, none cut`, async ({
      page,
    }) => {
      const mark = await openMark(page, 'en', width, by)
      const { cut, lines } = await markSeen(mark)
      const where = `at ${width}: ${JSON.stringify(lines)}`
      expect(cut, `${where}: cut away`).toBe('')
      expect(lines.join(''), where).toContain(by)
      expect(
        lines.filter((line) => /^·|·$/u.test(line)),
        where,
      ).toEqual([])
    })
