/**
 * The colour of each work item kind, as the owner set it.
 *
 * A colour is one custom property, `--color-kind-<colour>`, whose default is the
 * stylesheet's. A choice lands on the document's root over it, so every mark
 * follows at once without being drawn again, and taking the choice off is what
 * brings the default back. Only a choice is stored: a default moved in a later
 * build reaches everyone who never chose.
 *
 * A goal and a stage are one colour, as they are one glyph: a stage is a goal
 * standing under another. A stored colour of a kind this build does not have is
 * not read, so its colour starts from the default.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

type WorkItemKind = WorkItemBrief['kind']

/** The colours a choice is made for, each the colour of the kinds it lists. */
export const KIND_COLOR_KINDS = {
  bug: ['bug'],
  container: ['goal', 'stage'],
  improvement: ['improvement'],
  task: ['task'],
} as const satisfies Record<string, readonly WorkItemKind[]>
export type KindColor = keyof typeof KIND_COLOR_KINDS
const KIND_COLOR_KEYS = Object.keys(KIND_COLOR_KINDS) as KindColor[]

/** The colours the owner has chosen; the others keep the default. */
export type KindColors = Partial<Record<KindColor, string>>

/**
 * The token each colour renders as.
 *
 * @public read as source text by `scripts/sync-tokens.mjs`, which no import graph can see.
 */
const KIND_TOKENS: Record<KindColor, string> = {
  bug: '--color-kind-bug',
  container: '--color-kind-container',
  improvement: '--color-kind-improvement',
  task: '--color-kind-task',
}

/**
 * The defaults as literals, for a colour field, which resolves no `var()`. This is a
 * mirror of `tokens.css`, which `sync-tokens.mjs` rewrites: the palette to edit is there.
 */
export const DEFAULT_KIND_COLORS: Record<KindColor, string> = {
  bug: '#ff9db5',
  container: '#cfa0ff',
  improvement: '#7defdc',
  task: '#b4c6e0',
}

/**
 * The lightest ground a mark stands on, the hover card's, also mirrored. A colour that
 * clears it clears them all, and one darker than it never clears it, so it is the one
 * ground the hint has to ask about.
 */
const LIGHTEST_MARK_GROUND = '#464646'

const RGB_HEX = /^#[0-9a-f]{6}$/iu

/** What was stored, kept only where it is a `#rrggbb` of a colour this build has. */
export function readKindColors(raw: unknown): KindColors {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const colors: KindColors = {}
  for (const color of KIND_COLOR_KEYS) {
    const value = source[color]
    if (typeof value === 'string' && RGB_HEX.test(value)) colors[color] = value.toLowerCase()
  }
  return colors
}

export function kindColor(colors: KindColors, color: KindColor): string {
  return colors[color] ?? DEFAULT_KIND_COLORS[color]
}

/** Puts the choices on the root, and takes off whatever is no longer chosen. */
export function applyKindColors(
  colors: KindColors,
  root: HTMLElement = document.documentElement,
): void {
  for (const key of KIND_COLOR_KEYS) {
    const color = colors[key]
    if (color) root.style.setProperty(KIND_TOKENS[key], color)
    else root.style.removeProperty(KIND_TOKENS[key])
  }
}

function luminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((start) => {
    const unit = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** Whether a glyph in this colour falls under the 3:1 a mark owes its ground (WCAG 1.4.11). */
export function readsPoorly(color: string): boolean {
  const [high = 0, low = 0] = [luminance(color), luminance(LIGHTEST_MARK_GROUND)].sort(
    (first, second) => second - first,
  )
  return (high + 0.05) / (low + 0.05) < 3
}
