/**
 * An agent's name over an answer that was changed, in both languages. "changed · {time}"
 * takes most of a phone's line, and the name squeezed into what it left stood a word or two
 * to a line, broken inside its words; with a wide card the time keeps the end of the name's
 * first line.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { expectDateHeld } from './metaLine.ts'
import { asked, openQuestion, routeField } from './questionBackend.ts'
import { test } from './test.ts'

const LONG = 'an-agent-with-a-remarkably-long-working-name-that-runs-past-the-line'
const NAMES = ['claude-retrospective', LONG]
const CHANGED = { en: 'changed ·', ru: 'изменено ·' } as const

function changedAnswer(by: string) {
  return asked({
    status: 'answered',
    fields: [routeField],
    answers: { route: 'move' },
    own: {},
    field_notes: {},
    note: null,
    answered_by: by,
    by_person: false,
    resolved_at: '2026-10-24T12:00:00Z',
    revision: 3,
    answer_version: 2,
    history: [
      {
        version: 1,
        answers: { route: 'keep' },
        own: {},
        field_notes: {},
        note: null,
        answered_by: by,
        by_person: false,
        answered_at: '2026-10-23T12:00:00Z',
      },
    ],
  })
}

async function openChanged(page: Page, locale: keyof typeof CHANGED, by: string, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  const { card } = await openQuestion(page, [changedAnswer(by)])
  const meta = card.locator('.request-reply-meta')
  await expect(meta).toContainText(CHANGED[locale])
  await expect(meta).toContainText(by)
  return meta
}

for (const locale of ['en', 'ru'] as const) {
  for (const by of NAMES) {
    test(`${locale}: ${by} over a changed answer takes the whole line at 390, and the time its own`, async ({
      page,
    }) => {
      const meta = await openChanged(page, locale, by, 390)
      expect(await expectDateHeld(meta, `${locale} at 390`)).toBe('own line')
    })
  }

  test(`${locale}: a long name over a changed answer keeps the time on its first line at 1500`, async ({
    page,
  }) => {
    const meta = await openChanged(page, locale, LONG, 1500)
    expect(await expectDateHeld(meta, `${locale} at 1500`)).toBe('first line')
  })
}

/**
 * The asking agent's short name over an answered question on a phone, in Russian, whose time
 * is the longest: the icons to change the answer and to reply take the end of the line, so the
 * time takes its own line, and it starts where the name does rather than standing in the middle
 * of the head under nothing.
 */
test('ru: beside two icons at 390 the time takes its own line where the name starts', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width: 390, height: 900 })
  const { card } = await openQuestion(page, [
    asked({
      author: 'asking-agent',
      status: 'answered',
      answers: { route: 'move' },
      answered_by: 'worker-agent',
      by_person: false,
      resolved_at: '2026-10-24T12:00:00Z',
    }),
  ])
  await expect(card.getByRole('button', { name: 'Изменить ответ', exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Ответить', exact: true })).toBeVisible()
  expect(await expectDateHeld(card.locator('.request-meta'), 'ru at 390')).toBe('own line')
})
