/**
 * The colours that carry meaning, named once for every rule that asks about them.
 *
 * Three rules care: a meaning colour marks and never tints a surface
 * (`styles.mjs`), a line drawn in one is a status edge the ledger admits
 * (`lines.mjs`), and only `uiSystem.ts` may route a state to one
 * (`semantic-state-css.mjs`). Each used to spell the family as its own regex,
 * so a meaning colour added to the palette would have been guarded by
 * whichever of the three someone remembered to edit. A rule that silently
 * stops matching reports nothing, which reads as the invariant holding.
 *
 * The family is what `uiSystem.ts` maps tones to: `info` is work moving,
 * `success` finished and healthy, `warning` a decision waiting or a high
 * priority, `danger` stopped or urgent. Neutral is not in it, because neutral
 * is the absence of a meaning colour.
 */
export const SEMANTIC_TONES = Object.freeze(['danger', 'info', 'success', 'warning'])

const alternation = SEMANTIC_TONES.join('|')

/** A reference to a meaning colour anywhere in a value. */
export const SEMANTIC_COLOR_REFERENCE = new RegExp(`--color-(?:${alternation})\\b`)

/** A custom property that is exactly a meaning colour, with the tone captured. */
export const SEMANTIC_COLOR_PROPERTY = new RegExp(`^--color-(${alternation})$`, 'u')

/** The alternation itself, for a rule that composes it into a larger pattern. */
export const SEMANTIC_COLOR_NAMES = alternation
