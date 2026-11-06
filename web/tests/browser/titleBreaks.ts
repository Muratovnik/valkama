/**
 * Where a drawn title breaks and whether it stays in its box, read from where each of its
 * characters is drawn (`production-title-breaks.spec.ts`, `production-title-surfaces.spec.ts`).
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/** Slash-joined state names after a path: one word to a browser, wider than any line. */
export const SLASHED =
  'Valkama docs/plans/2026-10-26-docker-mcp-lifecycle/acceptance/loading/empty/error/unavailable/permission-denied'

/** One word wider than any title's line. */
export const ONE_WORD =
  'Supercalifragilisticexpialidociousandthensomemoreofitagainandagainandagainandagain'

interface Break {
  before: string
  /** The words either side of the break, `|` where it falls. */
  near: string
}

/**
 * The characters either side of each place the text goes on to a new line, read from where
 * each character is drawn: a line starts again where a character stands lower than the last
 * one drawn. A space that ends a line hangs there with no width, so it is read as text but
 * not as a place. Titles here are in the Basic Multilingual Plane, so a character is one
 * UTF-16 offset.
 */
export const breaksOf = (text: Locator) =>
  text.evaluate((element) => {
    const characters: { character: string; top: number | null }[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node
      Array.from(text.textContent ?? '', (character, at) => {
        range.setStart(text, at)
        range.setEnd(text, at + 1)
        const box = range.getClientRects()[0]
        characters.push({ character, top: box && box.width > 0 ? box.top : null })
        return character
      })
    }
    const words = (from: number, to: number) =>
      characters
        .slice(Math.max(from, 0), to)
        .map(({ character }) => character)
        .join('')
    let line: number | null = null
    return characters.flatMap(({ top }, at): Break[] => {
      if (top === null) return []
      const below = line !== null && top > line + 2
      line = top
      return below
        ? [
            {
              before: characters[at - 1].character,
              near: `${words(at - 8, at)}|${words(at, at + 8)}`,
            },
          ]
        : []
    })
  })

const NATURAL = new Set([' ', '/', '-'])

/**
 * Each break a title takes, as the words either side of it, and those of them that fall
 * anywhere but after a space, a slash or a hyphen.
 */
export async function breaksIn(text: Locator) {
  await expect(text).toBeVisible()
  const breaks = await breaksOf(text)
  return {
    count: breaks.length,
    inside: breaks.filter(({ before }) => !NATURAL.has(before)).map(({ near }) => near),
  }
}

/**
 * How far a title is drawn past its box, in pixels: past the content edge of the block it
 * stands in, as its characters are drawn, or as that block's scroll width says. Zero or less
 * when it stays inside. A block clipping its overflow cuts a word with nothing to say so.
 */
export const overflowOf = (text: Locator) =>
  text.evaluate((element) => {
    let block: Element = element
    while (block.parentElement && getComputedStyle(block).display.startsWith('inline'))
      block = block.parentElement
    const box = block.getBoundingClientRect()
    const edge = box.right - Number.parseFloat(getComputedStyle(block).paddingRight)
    const range = document.createRange()
    range.selectNodeContents(element)
    const drawn = Math.max(...Array.from(range.getClientRects(), (rect) => rect.right))
    return Math.max(drawn - edge, block.scrollWidth - block.clientWidth)
  })
