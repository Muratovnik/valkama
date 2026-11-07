/**
 * The row of controls at the foot of a question, read off the built page in every state it has,
 * in both languages, at a laptop's width and four phones': waiting, after a send that failed,
 * after the deadline, in the list of everything waiting, and while an answer is changed.
 *
 * Every line of the row holds a control, but for the one place the step of declining needs
 * where nothing else can give it: on a phone in the card, where only the comment's glyph stands
 * before the buttons, beside them (DESIGN.md). That band is the one empty band a row may show,
 * kept for the step's words unseen, and it is one line of them and the row's gap, in both
 * languages; its words, once drawn, take one line. The two answers are one pair at the row's end;
 * what comes before them
 * keeps the row's start at every width; the row is one line wherever its controls and the
 * asking fit on one; and the step moves nothing, its words drawn where the way to the task and
 * Check status stood, on one line where that place allows. On a phone the way to the task
 * stands in that place, and the comment's glyph never adds a line of its own: it stands beside
 * the buttons where it fits there, at 360 to 430, and only where it does not, at 320, first on
 * the place's line.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { expectStripOnColumn } from './confirmStrip.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { centre, expectRow, expectStep, near } from './requestRow.ts'
import { test } from './test.ts'

const LOCALES = ['en', 'ru'] as const
const WIDTHS = [1280, 430, 390, 360, 320] as const
type Locale = (typeof LOCALES)[number]

const LATE = '44444444-4444-4444-8444-444444444449'
const LIST_TITLE = /^(?:Needs my answer|Ждут моего ответа)/u
async function inLocale(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

const waitingAndLate = () => [
  asked({ created_at: '2026-10-24T11:00:00Z' }),
  asked({
    request_id: LATE,
    prompt: 'A question past its deadline',
    expires_at: '2020-01-01T10:00:00Z',
    created_at: '2026-10-24T09:00:00Z',
  }),
]

/** Chooses and sends, and the send fails: the row gains Check status. */
async function failSend(card: Locator, requests: { failNext: (status: number) => unknown }) {
  await card.getByRole('radio').first().check()
  requests.failNext(503)
  await card.locator('.request-onward').click()
  await expect(card.locator('.request-error')).toBeVisible()
}

const answered = asked({
  status: 'answered',
  answers: { route: 'move' },
  own: {},
  field_notes: {},
  answered_by: 'user',
  by_person: true,
  resolved_at: '2026-10-24T12:00:00Z',
  revision: 2,
  answer_version: 1,
})

for (const locale of LOCALES)
  for (const width of WIDTHS) {
    const at = `${locale} at ${width}`

    test(`${at}: the row of a question in its card, waiting, past its deadline and after a failed send`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const { card, requests } = await openQuestion(page, waitingAndLate())
      const waiting = card.first()
      await expect(waiting.locator('.request-actions')).toBeVisible()
      await expectRow(waiting.locator('.request-actions'), `${at} waiting`)
      await expectStep(waiting, `${at} waiting`)
      await expectRow(card.nth(1).locator('.request-actions'), `${at} past its deadline`)
      await failSend(waiting, requests)
      await expectRow(waiting.locator('.request-actions'), `${at} after a failed send`)
    })

    test(`${at}: the row of a question in the list of everything waiting, in each state`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const { drawer, requests } = await openQuestion(page, waitingAndLate())
      await page.keyboard.press('Escape')
      await expect(drawer).toHaveCount(0)
      await page.getByRole('button', { name: LIST_TITLE }).click()
      const dialog = page.getByRole('dialog', { name: LIST_TITLE })
      await expect(dialog).toHaveCSS('transform', 'none')
      const [top, late] = [
        dialog.locator('.request-card').first(),
        dialog.locator('.request-card').nth(1),
      ]
      await expectRow(top.locator('.request-actions'), `${at} listed`)
      await expectStep(top, `${at} listed`)
      await expectRow(late.locator('.request-actions'), `${at} listed past its deadline`)
      await failSend(top, requests)
      await expectRow(top.locator('.request-actions'), `${at} listed after a failed send`)
    })

    test(`${at}: the asking before a change is dropped puts its buttons at its end, on the column's edge`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const { card } = await openQuestion(page, [answered])
      await card.locator('.request-change').click()
      await card.getByRole('radio').first().check()
      await card.locator('.request-way-out').click()
      await expect(card.locator('.confirm-strip')).toBeVisible()
      await expectStripOnColumn(card.locator('.confirm-strip'), card, `${at} asking`)
    })

    test(`${at}: changing an answer keeps the comment's glyph on the line of Cancel and Save`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const { card } = await openQuestion(page, [answered])
      await card.locator('.request-change').click()
      const row = card.locator('.request-actions')
      await expect(row.locator('.request-onward')).toBeVisible()
      const { members } = await expectRow(row, `${at} changing`)
      const centres = members.map((member) => centre(member))
      for (const other of centres)
        expect(near(other, centres[0] ?? other), `${at}: the glyph with the pair`).toBe(true)
    })
  }
