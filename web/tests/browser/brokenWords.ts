/**
 * The words a wrapped text breaks inside: each run of letters and digits in the elements a
 * selector finds that does not stand on one line, words for a screen reader alone left out. A
 * text may wrap between words, and after a hyphen or a comma; a word cut in two, «понедельни»
 * over «к», is what this finds. A selector that finds no word to read is refused, since it
 * would find none broken.
 */
import type { Page } from '@playwright/test'

export function brokenWords(page: Page, selector: string) {
  return page.evaluate((chosen) => {
    const broken: string[] = []
    let read = 0
    for (const element of document.querySelectorAll(chosen)) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        // Words for a screen reader alone stand in a box of one pixel, a letter to a line.
        if (node.parentElement?.closest('.visually-hidden')) continue
        const text = node.textContent ?? ''
        for (const word of text.matchAll(/[\p{L}\p{N}]+/gu)) {
          read += 1
          const range = document.createRange()
          range.setStart(node, word.index)
          range.setEnd(node, word.index + word[0].length)
          const lines = new Set(
            [...range.getClientRects()]
              .filter((one) => one.width > 0)
              .map((one) => Math.round(one.top)),
          )
          if (lines.size > 1) broken.push(word[0])
        }
      }
    }
    if (read === 0) throw new Error(`${chosen} holds no word to read`)
    return broken
  }, selector)
}
