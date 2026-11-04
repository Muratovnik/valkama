import type { Locator } from '@playwright/test'

/**
 * Where a line's first separator stands: how far it is from the last glyph before it and
 * from what follows it — the first glyph after it, or the edge of a filled control when one
 * starts there. Read off the painted glyphs, since a space, a flex gap and a control's own
 * inset all look alike in the source and only the sum is seen.
 */
export function separatorRoom(line: Locator) {
  return line.evaluate((node) => {
    const glyphs: { at: Text; ch: string; left: number; right: number }[] = []
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      for (const [at, ch] of [...(text.textContent ?? '')].entries()) {
        const range = document.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + 1)
        const rect = range.getBoundingClientRect()
        if (ch.trim() && rect.width > 0 && rect.height > 0)
          glyphs.push({ at: text as Text, ch, left: rect.left, right: rect.right })
      }
    }
    const mark = glyphs.findIndex(({ ch }) => ch === '·' || ch === ':')
    const [before, separator, after] = [glyphs[mark - 1], glyphs[mark], glyphs[mark + 1]]
    if (!before || !separator || !after) return null
    // A control whose fill is drawn at rest starts where its fill does.
    const bare = new Set(['rgba(0, 0, 0, 0)', 'transparent'])
    let edge = after.left
    for (let up = after.at.parentElement; up && up !== node; up = up.parentElement)
      if (!bare.has(getComputedStyle(up).backgroundColor))
        edge = Math.min(edge, up.getBoundingClientRect().left)
    return {
      separator: separator.ch,
      before: separator.left - before.right,
      after: edge - separator.right,
    }
  })
}
