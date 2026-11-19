/**
 * A section's switch between its drawings and its table, pressed as a reader presses it, in either
 * language. A split of one whole is drawn as a ring or as ranked bars, any other chart as its one
 * chart; a spec that reads ranked lines, day columns and small charts reads a split's bars and
 * every other section's chart, whichever drawing the section opens on.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

const LINED_WORDS = (['en', 'ru'] as const).flatMap((locale) => [
  messages[locale].analytics.shown.chart,
  messages[locale].analytics.shown.bars,
])

/** The name of the option that draws a section as its bars or as its one chart. */
export const LINED = new RegExp(`^(${LINED_WORDS.join('|')})$`, 'u')

/** What `data-shown` says of a section drawn as its bars or its one chart. */
export const LINED_SHOWN = /^(chart|bars)$/u

/** Draws `section`, a `.chart-section`, as its bars or as its one chart. */
export async function drawLined(section: Locator) {
  const option = section.locator(':scope > .level-head').getByRole('radio', { name: LINED })
  if (!(await option.isChecked())) await option.click()
  await expect(section).toHaveAttribute('data-shown', LINED_SHOWN)
}

/** Draws every section in `where` as its bars or as its one chart. */
export async function drawAllLined(where: Locator | Page) {
  for (const section of await where.locator('.chart-section').all()) await drawLined(section)
}
