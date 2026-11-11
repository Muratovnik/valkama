/**
 * Twelve changes of account over four weeks take one line under the day chart, which counts
 * them and whose hint says each; the lines up the plot stay, with no numbers.
 */
import { expect } from '@playwright/test'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

const FIRST = value('3f9a1b2c-5d6e-4f70-8a9b-0c1d2e3f4a5b')
const SECOND = value('77de0a1c-1111-4222-8333-444455556666')

/** An hour on each of the thirteen days that end on Wednesday 11 November, the account switching daily. */
const SWITCHING: TimedStretch[] = Array.from({ length: 13 }, (_, back) => ({
  at: new Date(2026, 10, 11 - back, 10),
  group: {
    work_item: task(1, 'Import the planning documents'),
    account: back % 2 ? FIRST : SECOND,
  },
  spend: { seconds: 3600 },
}))

test('twelve account changes are one line under the chart, each whole in its hint', async ({
  page,
}, info) => {
  await serve(page, SWITCHING)
  const analytics = await openReport(page, 1440, pageAt({ by: 'work_item', period: 'weeks4' }))
  const days = analytics.locator('.spending-days')
  await days.getByRole('radio', { name: 'Chart' }).click()
  const notes = days.locator('.period-notes')
  await expect(notes.locator('.period-note')).toHaveCount(1)
  await expect(notes).toHaveText('Account changes: 12')

  const block = await notes.evaluate((element) => ({
    block: element.getBoundingClientRect().height,
    line: element.querySelector('.period-note')?.getBoundingClientRect().height ?? 0,
  }))
  await record(info, 'changes-folded', block)
  expect(block.block).toBeCloseTo(block.line, 0)

  // The lines up the plot stay, one per change, and carry no number.
  await expect(days.locator('.period-mark')).toHaveCount(12)
  const numbers = await days.locator('.period-markers .chart-tick').allTextContents()
  expect(numbers).toHaveLength(12)
  for (const number of numbers) expect(number.trim()).toBe('')

  await notes.locator('.period-note-text').hover()
  const hint = page.getByRole('tooltip')
  await expect(hint).toBeVisible()
  const said = (await hint.textContent()) ?? ''
  expect(said.split('; ')).toHaveLength(12)
  expect(said).toContain('Accounts:')
})
