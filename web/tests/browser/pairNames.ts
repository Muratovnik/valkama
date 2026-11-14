/**
 * Where a name of two parts stands in the page: what of its separator and second part a box
 * that clips it hides, for the specs that hold a pair's end whole.
 */
import type { Page } from '@playwright/test'

/**
 * Each name a selector finds: its words, whether they are cut — the text of its words laid out
 * whole is wider than its box — and how many pixels of the separator and the second part stand
 * outside a box that clips them, from the name's text up to the name. The words are measured on
 * ranges over the characters, so it holds whatever elements the name is drawn with.
 */
export async function pairNames(page: Page, selector: string) {
  return page.evaluate((chosen) => {
    const SEPARATOR = ' · '
    /** The text nodes of an element with the offset each starts at in its text. */
    const textNodes = (element: Element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const found: { from: number; node: Text }[] = []
      let from = 0
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        found.push({ node: node as Text, from })
        from += node.textContent?.length ?? 0
      }
      return found
    }
    /** A range over characters `from` to `to` of an element's text. */
    function rangeOf(element: Element, from: number, to: number) {
      const range = document.createRange()
      for (const { node, from: start } of textNodes(element)) {
        const end = start + node.length
        if (from >= start && from <= end) range.setStart(node, from - start)
        if (to >= start && to <= end) {
          range.setEnd(node, to - start)
          break
        }
      }
      return range
    }
    return [...document.querySelectorAll<HTMLElement>(chosen)].map((name) => {
      const text = name.textContent ?? ''
      const words = text.trim()
      const box = name.getBoundingClientRect()
      let whole = 0
      for (const { node } of textNodes(name)) {
        const range = document.createRange()
        range.selectNodeContents(node)
        whole += range.getBoundingClientRect().width
      }
      const style = getComputedStyle(name)
      let room = box.width
      for (const side of [
        'paddingLeft',
        'paddingRight',
        'borderLeftWidth',
        'borderRightWidth',
      ] as const)
        room -= Number.parseFloat(style[side])
      const separator = text.lastIndexOf(SEPARATOR)
      if (separator < 0) return { words, cut: whole > room + 0.5, hidden: null }
      // From the separator's dot to the last character of the second part.
      const end = rangeOf(name, separator + 1, text.trimEnd().length)
      const part = end.getBoundingClientRect()
      let left = -Infinity
      let right = Infinity
      for (let clip = end.startContainer.parentElement; clip; clip = clip.parentElement) {
        const style = getComputedStyle(clip)
        if (style.overflowX !== 'visible') {
          // Its padding box, to the fraction of a pixel that `clientWidth` rounds away.
          const edges = clip.getBoundingClientRect()
          left = Math.max(left, edges.left + Number.parseFloat(style.borderLeftWidth))
          right = Math.min(right, edges.right - Number.parseFloat(style.borderRightWidth))
        }
        if (clip === name) break
      }
      const hidden = Math.max(0, part.right - right) + Math.max(0, left - part.left)
      return {
        words,
        cut: whole > room + 0.5,
        hidden: Math.round(hidden * 1000) / 1000,
        end: Math.round(part.width * 100) / 100,
      }
    })
  }, selector)
}
