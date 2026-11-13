/**
 * The colours of the list's own find, against the rows they are drawn on.
 *
 * Every match lies on a list row, at rest or pointed at, and its words take the
 * full ink there; the current one is told from the others by lightness, 3:1 as
 * a mark that has to be seen (WCAG 1.4.11), and not by hue alone.
 */
import { expect, test } from 'vitest'

import { contrast, over, token } from './paletteColors.ts'

/** Two grounds side by side read as two at this ratio, as the palette's grounds do. */
const APART = 1.15

test("the list's find marks a match on a row and tells the current one apart", () => {
  const current = token('--color-find-current')
  for (const ground of ['--color-surface', '--color-surface-hover']) {
    const below = token(ground)
    const match = over(token('--color-find-match'), below)
    expect(contrast(match, below), `a match on ${ground} off its row`).toBeGreaterThanOrEqual(APART)
    expect(
      contrast(token('--color-text'), match),
      `a match's words on ${ground}`,
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(current, match),
      `the current match on ${ground} from the others`,
    ).toBeGreaterThanOrEqual(3)
  }
  expect(contrast(token('--color-text-on-find'), current)).toBeGreaterThanOrEqual(4.5)
})
