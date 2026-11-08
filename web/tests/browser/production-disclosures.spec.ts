/**
 * What shows more of something — earlier answers, the rest of a list, the threads a view hides — is the bare text weight, its words in line with what it opens, apart
 * from the actions beside it, which rest on the ghost's fill.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { openCard } from './editorPage.ts'
import { asked, openQuestion, routeField } from './questionBackend.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

const BARE = 'rgba(0, 0, 0, 0)'

/** A button's ground at rest and where its words start, read in one frame. */
const look = (button: Locator) =>
  button.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const words = [...range.getClientRects()].find((rect) => rect.width > 0)
    return { ground: getComputedStyle(node).backgroundColor, words: words?.left ?? Number.NaN }
  })
const startOf = (target: Locator) => target.evaluate((node) => node.getBoundingClientRect().left)

for (const width of [1500, 390])
  test(`a block's comment press is bare in its head at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { card, drawer } = await openQuestion(page, [asked()])
    await expect(drawer).toHaveCSS('transform', 'none')
    const name = /^Comment on the block of questions: /u
    const toggle = await look(card.getByRole('button', { name }))
    expect(toggle.ground, String(name)).toBe(BARE)
    const send = await look(card.locator('.request-onward'))
    expect(send.ground).not.toBe(BARE)
  })

test('earlier answers open from a bare line in the answer’s column', async ({ page }) => {
  const { card, drawer } = await openQuestion(page, [
    asked({
      status: 'answered',
      fields: [routeField],
      answers: { route: 'move' },
      own: {},
      field_notes: {},
      note: null,
      answered_by: 'user',
      by_person: true,
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
          answered_by: 'claude',
          by_person: false,
          answered_at: '2026-10-24T10:30:00Z',
        },
      ],
    }),
  ])
  await expect(drawer).toHaveCSS('transform', 'none')
  const earlier = await look(card.getByRole('button', { name: 'Previous answers (1)' }))
  expect(earlier.ground).toBe(BARE)
  const column = await startOf(card.locator('.request-reply-meta'))
  expect(Math.abs(earlier.words - column)).toBeLessThanOrEqual(1)
})

test('the threads a view hides come back from a bare line after the words that count them', async ({
  page,
}) => {
  const { backend, drawer } = await openCard(page)
  backend.item.comments.push(...talkedOn())
  await page.reload()
  await drawer.getByRole('radio', { name: 'Unresolved 3' }).click()
  const hidden = drawer.locator('.thread-hidden')
  await expect(hidden).toContainText('1 resolved thread hidden')
  const show = await look(hidden.getByRole('button', { name: 'Show all', exact: true }))
  expect(show.ground).toBe(BARE)
  // One gap after the sentence, as the next word of the line, not a gap and an inset.
  const said = await hidden.evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node.firstChild as Node)
    return Math.max(...[...range.getClientRects()].map((rect) => rect.right))
  })
  expect(show.words - said).toBeLessThanOrEqual(9)
})
