/** A computed colour with nothing in it: `transparent`, or any colour at alpha 0. */
const CLEAR = /^(?:transparent|rgba\(.*,\s*0\))$/u

/** The fill drawn behind a node: the first ancestor whose ground is not clear, or null on none. */
function groundBehind(node: Element): string | null {
  for (let at = node.parentElement; at; at = at.parentElement) {
    const fill = getComputedStyle(at).backgroundColor
    if (!CLEAR.test(fill)) return fill
  }
  return null
}

/**
 * Whether a node's own ground is the one already behind it, so that as a block it could not be
 * told from what it lies on: a sheet's tone on a sheet.
 */
export function levelWithGround(node: Element): boolean {
  const own = getComputedStyle(node).backgroundColor
  return !CLEAR.test(own) && own === groundBehind(node)
}
