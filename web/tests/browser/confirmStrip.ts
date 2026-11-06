import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/**
 * Where a confirm strip's parts are drawn, against the column it stands in: the first line of
 * its words (a Range over them), its buttons, the inside edges of the strip and of the column,
 * and whether its ground differs from the nearest ground behind it.
 */
const stripGeometry = async (strip: Locator, column: Locator) =>
  column.evaluate(
    (columnNode, stripNode) => {
      if (!(stripNode instanceof HTMLElement)) throw new TypeError('No strip')
      const inside = (node: Element) => {
        const box = node.getBoundingClientRect()
        const style = getComputedStyle(node)
        return {
          left: box.left + Number.parseFloat(style.paddingLeft),
          right: box.right - Number.parseFloat(style.paddingRight),
        }
      }
      const words = stripNode.querySelector('.confirm-message')
      const text = words && document.createTreeWalker(words, NodeFilter.SHOW_TEXT).nextNode()
      if (!text) throw new Error('The strip has no words')
      const range = document.createRange()
      range.selectNodeContents(text)
      const first = range.getClientRects()[0]
      if (!first) throw new Error('The words are not drawn')
      const clear = 'rgba(0, 0, 0, 0)'
      let behind = stripNode.parentElement
      while (behind && getComputedStyle(behind).backgroundColor === clear)
        behind = behind.parentElement
      const ground = getComputedStyle(stripNode).backgroundColor
      return {
        buttons: [...stripNode.querySelectorAll('button')].map((button) => {
          const box = button.getBoundingClientRect()
          return { left: box.left, right: box.right, top: box.top, width: box.width }
        }),
        column: inside(columnNode),
        drawnAsBlock:
          ground !== clear &&
          ground !== (behind ? getComputedStyle(behind).backgroundColor : clear),
        strip: inside(stripNode),
        wordsLeft: first.left,
      }
    },
    await strip.elementHandle(),
  )

const near = (one: number, other: number) => Math.abs(one - other) <= 1

/**
 * A strip's buttons stand at its end and wrap together, as every form's do, and its words stand
 * on the column's edge unless a ground of its own shows it as a block. `block` says which of the
 * two the place it stands in calls for: a block on a ground below the strip's tone, the column's
 * edge on a sheet of that tone.
 */
export async function expectStripOnColumn(
  strip: Locator,
  column: Locator,
  what: string,
  block = false,
) {
  await expect(strip).toBeVisible()
  const drawn = await stripGeometry(strip, column)
  expect(drawn.drawnAsBlock, `${what}: ${block ? 'a block' : 'no block'} where it stands`).toBe(
    block,
  )
  if (!drawn.drawnAsBlock)
    expect(
      Math.abs(drawn.wordsLeft - drawn.column.left),
      `${what}: words on the column's edge`,
    ).toBeLessThanOrEqual(1)
  const { buttons } = drawn
  const room = drawn.strip.right - drawn.strip.left
  let together = 8 * (buttons.length - 1)
  for (const button of buttons) together += button.width
  if (together <= room)
    for (const button of buttons)
      expect(near(button.top, buttons[0]?.top ?? button.top), `${what}: one line`).toBe(true)
  // The last button of each line ends at the strip's end.
  for (const [index, button] of buttons.entries()) {
    const next = buttons[index + 1]
    if (!next || !near(next.top, button.top))
      expect(near(button.right, drawn.strip.right), `${what}: at the end`).toBe(true)
  }
}
