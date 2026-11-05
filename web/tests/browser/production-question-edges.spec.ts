/**
 * One column, one set of edges, in the real 25-field review at a laptop's width and a phone's.
 * A group's heading starts on the edge its rows start on and draws nothing left of it; what a
 * point's answer opens stands in by the step the row's own words stand in, so its rows start
 * under the point's words; and the answered summary sets that part in by the step its reply
 * is set in from the prompt. The heading's chevron once hung four pixels into the column with
 * its title twenty-four pixels further, and the opened part stood at a third edge between them.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { REVIEW_PROMPT, reviewFields } from '../support/reviewQuestion.ts'
import { drawnBox, startOf } from './edges.ts'
import { asked, openQuestion, send } from './questionBackend.ts'
import { test } from './test.ts'

const GROUPS = [...new Set(reviewFields.map((field) => field.group).filter(Boolean))] as string[]

async function openReview(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 })
  const { card } = await openQuestion(page, [
    asked({ prompt: REVIEW_PROMPT, fields: reviewFields, title: 'Review of the checks' }),
  ])
  await expect(card.locator('.request-point')).toHaveCount(18)
  return card
}

const point = (card: Locator, label: string) => card.locator('.request-point', { hasText: label })

for (const width of [1280, 390]) {
  test(`a group's heading starts where its rows start and draws nothing left of them, at ${width}`, async ({
    page,
  }) => {
    const card = await openReview(page, width)
    for (const title of GROUPS) {
      const group = card.getByRole('region', { name: new RegExp(`^${title}`, 'u') })
      const heading = group.getByRole('button', { name: new RegExp(`^${title}`, 'u') })
      const rows = await startOf(group.locator('.request-point').first())
      const words = await drawnBox(heading.getByText(title, { exact: true }))
      const glyph = await drawnBox(heading.locator('svg'))
      expect(Math.abs(words.left - rows), `${title}: its words`).toBeLessThanOrEqual(1)
      expect(glyph.left, `${title}: its chevron`).toBeGreaterThanOrEqual(rows - 1)
      expect(glyph.left, `${title}: its chevron after its words`).toBeGreaterThan(words.right)
    }
  })

  test(`what a point's answer opens starts under the point's words, at ${width}`, async ({
    page,
  }) => {
    const card = await openReview(page, width)
    const row = point(card, 'P13 The 400-line limit')
    await row.getByRole('radio', { name: 'Accept', exact: true }).click()
    const opened = card.getByRole('radiogroup', { name: /Way/u })
    await expect(opened).toBeVisible()
    const words = await drawnBox(row.locator('.request-point-label'))
    expect(Math.abs((await startOf(opened)) - words.left)).toBeLessThanOrEqual(1)
  })

  test(`the answered summary sets an opened part in by its reply's step, at ${width}`, async ({
    page,
  }) => {
    const card = await openReview(page, width)
    await card.getByRole('button', { name: 'Accept recommended', exact: true }).click()
    await send(card).click()
    await card.getByRole('button', { name: /^Show all/u }).click()
    const reply = card.locator('.request-reply')
    const step = await reply.evaluate(
      (node) => Number.parseFloat(getComputedStyle(node).paddingInlineStart) || 0,
    )
    expect(step).toBeGreaterThan(0)
    const label = card.locator('.request-summary-point', { hasText: 'P13' })
    const under = label.locator('xpath=following-sibling::*[1]')
    const set = (await startOf(under)) - (await startOf(label))
    expect(Math.abs(set - step)).toBeLessThanOrEqual(1)
  })
}
