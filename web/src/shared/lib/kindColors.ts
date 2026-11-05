/**
 * The colour of each work item kind, as the owner set it.
 *
 * A kind's colour is one custom property, `--color-kind-<kind>`, whose default is
 * the stylesheet's. A choice lands on the document's root over it, so every mark
 * follows at once without being drawn again, and taking the choice off is what
 * brings the default back. Only a choice is stored: a default moved in a later
 * build reaches everyone who never chose.
 */
import { WORK_ITEM_KINDS } from '@/shared/api/planningModel.ts'

type WorkItemKind = (typeof WORK_ITEM_KINDS)[number]

/** The kinds the owner has chosen a colour for; the others keep the default. */
export type KindColors = Partial<Record<WorkItemKind, string>>

/**
 * The token each kind renders as.
 *
 * @public read as source text by `scripts/sync-tokens.mjs`, which no import graph can see.
 */
const KIND_TOKENS: Record<WorkItemKind, string> = {
  bug: '--color-kind-bug',
  epic: '--color-kind-epic',
  improvement: '--color-kind-improvement',
  task: '--color-kind-task',
}

/**
 * The defaults as literals, for a colour field, which resolves no `var()`. This is a
 * mirror of `tokens.css`, which `sync-tokens.mjs` rewrites: the palette to edit is there.
 */
export const DEFAULT_KIND_COLORS: Record<WorkItemKind, string> = {
  bug: '#ff9db5',
  epic: '#cfa0ff',
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

/** What was stored, kept only where it is a `#rrggbb` of a kind this build has. */
export function readKindColors(raw: unknown): KindColors {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const colors: KindColors = {}
  for (const kind of WORK_ITEM_KINDS) {
    const value = source[kind]
    if (typeof value === 'string' && RGB_HEX.test(value)) colors[kind] = value.toLowerCase()
  }
  return colors
}

export function kindColor(colors: KindColors, kind: WorkItemKind): string {
  return colors[kind] ?? DEFAULT_KIND_COLORS[kind]
}

/** Puts the choices on the root, and takes off whatever is no longer chosen. */
export function applyKindColors(
  colors: KindColors,
  root: HTMLElement = document.documentElement,
): void {
  for (const kind of WORK_ITEM_KINDS) {
    const color = colors[kind]
    if (color) root.style.setProperty(KIND_TOKENS[kind], color)
    else root.style.removeProperty(KIND_TOKENS[kind])
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
