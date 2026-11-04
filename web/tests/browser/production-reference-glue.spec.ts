/**
 * A reference in text is a button, an atomic box, and a line could break right after
 * it: «MAIN-12» at the end of a line and «, план» at the start of the next. What is
 * written against a reference stays on its line now, at every width a line can take.
 */
import { expect } from '@playwright/test'

import { openReported, reference } from './previewPage.ts'
import { test } from './test.ts'

const BODY = [
  'Связано с MAIN-12, план отдельно; ещё MAIN-13, затем (MAIN-14) и «MAIN-15», а также MAIN-16.',
  'Related to MAIN-12, the plan apart; then MAIN-13, next (MAIN-14) and "MAIN-15", and MAIN-16.',
].join('\n\n')

for (const width of [1500, 390]) {
  test(`what is written against a reference keeps to its line, at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { entry } = await openReported(page, BODY)
    await expect(reference(entry, 'MAIN-16').first()).toBeVisible()

    // Every width the entry can be narrowed to, one pixel at a time: at each, the first
    // character after a reference, when nothing parts them, is on the reference's line.
    const split = await entry.evaluate((element) => {
      const box = element as HTMLElement
      const texts: Text[] = []
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node.textContent) texts.push(node as Text)
      /** The first character after `button` in the text, as a range, or null at the end. */
      function after(button: Element): Range | null {
        const next = texts.find(
          (text) =>
            !button.contains(text) &&
            (button.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        )
        if (!next) return null
        const range = document.createRange()
        range.setStart(next, 0)
        range.setEnd(next, 1)
        return range
      }
      const found: string[] = []
      for (let room = 380; room >= 160; room -= 1) {
        box.style.width = `${room}px`
        for (const button of box.querySelectorAll('button.rich-reference')) {
          const range = after(button)
          if (!range || /^\s/u.test(range.toString())) continue
          const last = [...button.getClientRects()].at(-1)
          if (last && range.getBoundingClientRect().top > last.bottom - 2)
            found.push(`${room}px: ${button.textContent}${range.toString()}`)
        }
      }
      box.style.width = ''
      return found
    })
    expect(split).toEqual([])
  })
}
