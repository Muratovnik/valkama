/**
 * The one other question about the window: whether a finger presses, which is a coarse pointer
 * or a phone-wide screen. A finger is as wide in any box a control stands in, so that one asks
 * the window, once, in `reach.css`, and every control takes its target from there. Four more
 * files asked it in their own words and the rule did not see them: it read only the first
 * condition of a query list, and the width stood second, after `(pointer: coarse)`.
 *
 * The owner may ask that one list and nothing beside it. Holding only that `(pointer: coarse)`
 * stood somewhere in it let `(pointer: coarse), (width <= 4000px)` through: a different window
 * question asked in the finger's name.
 */
export const FINGER_QUERY_OWNER = 'shared/ui/reach.css'
const FINGER_QUERY = ['(pointer: coarse)', '(width <= 620px)']

/** A window-width feature: `(width <= 620px)`, `(min-width: 40rem)`, `(400px < width)`. */
export const WIDTH_FEATURE = /(?<![\w-])(?:min-|max-)?(?:device-)?width(?![\w-])/i

/** The conditions of a query list, split at the commas that stand outside every bracket. */
export function conditionsOf(list) {
  const conditions = ['']
  let depth = 0
  for (const character of list) {
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    if (character === ',' && depth === 0) conditions.push('')
    else conditions[conditions.length - 1] += character
  }
  return conditions.map((condition) => condition.trim())
}

/** Whether a list is the finger query, condition by condition and in its order, spaces and case aside. */
export const isFingerQuery = (conditions) =>
  conditions.join(',').replaceAll(/\s+/g, '').toLowerCase() ===
  FINGER_QUERY.join(',').replaceAll(' ', '')

/** A condition that asks whether the pointer is coarse, any pointer's included. */
const COARSE_POINTER = /(?<![\w-])(?:any-)?pointer\s*:\s*coarse/i

/**
 * Every query list that asks whether a finger presses without asking the window's width: that is
 * the finger query's first half, asked on its own. The finger is asked once, in `reach.css`, with
 * the width beside it, and a list that holds a width is the window rule's to read. A coarse
 * pointer asked anywhere else, or alone in `reach.css`, was a second finger with its own target.
 */
export function coarsePointerQueries(file, source) {
  return [...source.matchAll(/@media\b([^{;]*)\{/gi)]
    .map(([, list]) => conditionsOf(list))
    .filter(
      (conditions) =>
        conditions.some((condition) => COARSE_POINTER.test(condition)) &&
        !conditions.some((condition) => WIDTH_FEATURE.test(condition)),
    )
    .map(() => `${file}: a finger is asked once, in reach.css; take the target from its classes`)
}
