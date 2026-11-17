/**
 * The order a reader meets parts in, read from the document rather than from the nesting: a
 * wrapper or a class added for layout keeps the reading order and changes nothing here, while two
 * parts trading places do. Each selector names one part inside `root`; one that matches nothing
 * fails, so the order is never read over a part that is not there.
 */
export function documentOrder(root: Element, selectors: readonly string[]): string[] {
  const placed = selectors.map((selector) => {
    const found = root.querySelector(selector)
    if (!found) throw new Error(`${selector} stands nowhere in the part read`)
    return { found, selector }
  })
  // Every element in `root`, in the order a reader meets them.
  const read = [...root.querySelectorAll('*')]
  return placed
    .toSorted((one, other) => read.indexOf(one.found) - read.indexOf(other.found))
    .map((one) => one.selector)
}

/**
 * The words a reader meets in `root` before reaching `part`, however the parts between are nested:
 * a paragraph put ahead of `part` adds its words here wherever it stands, and a wrapper adds none.
 */
export function textBefore(root: Element, part: Element): string {
  const range = document.createRange()
  range.setStart(root, 0)
  range.setEndBefore(part)
  return range.toString().trim()
}
