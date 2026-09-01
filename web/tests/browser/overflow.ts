import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Content that is being cut off without saying so.
 *
 * Three reviews in a row have reported the same kind of defect — a status word
 * touching the edge of a card, a count half outside its row — and each time it
 * was found by eye, on one screen, at one width. Nothing in the suite could see
 * it: every assertion here names an element and checks a property of it, and a
 * clipped box has no property that is wrong. Its width is what it was told to
 * be; it is the content inside that no longer fits.
 *
 * So this reads the browser's own answer instead. An element whose scrollWidth
 * exceeds its clientWidth holds more than it shows. That is perfectly fine when
 * the element scrolls, and it is fine when it truncates on purpose — an
 * ellipsis or a line clamp is a designed shortening, and the reader can see
 * that something was left out. What is left is the case with no affordance at
 * all: a box that quietly clips, which is how a lane 30px narrower than someone
 * assumed turns into a word with its last letter missing.
 */
export async function expectNoSilentClipping(page: Page, where: string) {
  const clipped = await page.evaluate(() => {
    const findings: { overflow: number; selector: string; text: string }[] = []
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const describeElement = (element: Element) => {
      const classes = element.className
      const name = typeof classes === 'string' && classes ? `.${classes.split(/\s+/)[0]}` : ''
      return `${element.tagName.toLowerCase()}${name}`
    }
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const overflow = element.scrollWidth - element.clientWidth
      if (overflow <= 1) continue
      const style = getComputedStyle(element)
      if (style.overflowX !== 'hidden' && style.overflowX !== 'clip') continue
      // A designed shortening: the reader can see that something was cut.
      if (style.textOverflow === 'ellipsis') continue
      if (style.webkitLineClamp !== 'none') continue
      // A box of a pixel or less shows nothing to anyone who can see: it is the
      // one-pixel cutout that carries text for a screen reader, or an element
      // that has not been laid out yet. Both hold more than they show on
      // purpose, which is the whole point of them.
      if (element.clientWidth <= 1 || element.clientHeight <= 1) continue
      findings.push({
        selector: describeElement(element),
        overflow,
        text: (element.textContent ?? '').trim().slice(0, 60),
      })
    }
    return findings
  })
  expect(
    clipped,
    `${where}: ${clipped.length} element(s) clip their own content with no ellipsis, clamp or scroll — ${clipped
      .map((finding) => `${finding.selector} by ${finding.overflow}px ("${finding.text}")`)
      .join('; ')}`,
  ).toEqual([])
}
