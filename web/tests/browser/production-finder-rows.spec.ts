/**
 * A row of the task finder reads as one line of text even when its title takes two: the
 * reference, the title's first line and the state stand on one baseline. Centred in the row,
 * the reference hung between the two lines of a long title.
 */
import { expect } from '@playwright/test'

import { openFinder } from './finderPage.ts'
import { test } from './test.ts'

const LONG_TITLE =
  'Read an attached planning store that an older build wrote without migrating it, and name every scope the read had to skip instead of dropping it'

/** Three results: two long titles around a short one. */
const titles = [LONG_TITLE, 'Follow-up', `Attached copy: ${LONG_TITLE}`]

// Wide, one line holds the reference, the title and the state; on a phone the title has a line
// of its own under them.
for (const { width, titleBeside } of [
  { width: 1440, titleBeside: true },
  { width: 390, titleBeside: false },
]) {
  test(`at ${width}px a result's reference stands on the baseline of its title's first line`, async ({
    page,
  }) => {
    const dialog = await openFinder(page, width, titles)
    const results = dialog.getByRole('option')

    // A zero-sized inline box stands on the baseline of the line it starts.
    const lines = await results.evaluateAll((options) =>
      options.map((option) => {
        const baseline = (selector: string) => {
          const part = option.querySelector(selector)
          if (!part) return Number.NaN
          const probe = document.createElement('span')
          probe.style.cssText = 'display:inline-block;width:0;height:0'
          part.prepend(probe)
          const { bottom } = probe.getBoundingClientRect()
          probe.remove()
          return bottom
        }
        const title = option.querySelector('.command-title')
        const tall = title ? title.getBoundingClientRect().height : 0
        return {
          reference: baseline('.command-reference'),
          title: baseline('.command-title'),
          detail: baseline('.command-detail'),
          lineHeight: title ? Number.parseFloat(getComputedStyle(title).lineHeight) : 0,
          tall,
        }
      }),
    )
    // Two of the titles do take two lines, or the row proves nothing.
    expect(lines.filter(({ lineHeight, tall }) => tall > 1.5 * lineHeight)).toHaveLength(2)
    for (const line of lines) {
      expect(Math.abs(line.reference - line.detail)).toBeLessThanOrEqual(1)
      expect(Math.abs(line.reference - line.title) <= 1).toBe(titleBeside)
    }
  })
}
