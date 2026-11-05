import { parseRichText, plainText } from '@/shared/lib/richText.ts'
import type { RichBlock } from '@/shared/lib/richText.ts'

/** What the server holds a checklist to: how many steps, and how long the text of one. */
export const MAX_STEPS = 100
export const MAX_STEP_TEXT = 1000

/** One point of a list in what an entry says. */
export interface ListPoint {
  /** How deep in other lists it stands: 0 for a point of a list of its own. */
  depth: number
  /** Its Markdown, which the step will say, since a step is drawn as rich text too. */
  source: string
  /** The words it reads as, for its row in the form. */
  words: string
}

/** Why a point cannot be chosen: a step says it already, a point above says it, or too long. */
type PointBar = 'exists' | 'long' | 'repeat'

export interface PointStanding {
  bar: PointBar | null
  point: ListPoint
}

function* pointsIn(blocks: readonly RichBlock[], depth: number): Generator<ListPoint> {
  for (const block of blocks) {
    if (block.kind === 'quote') yield* pointsIn(block.children, depth)
    if (block.kind !== 'list') continue
    for (const item of block.items) {
      if (item.source) yield { depth, source: item.source, words: plainText(item.source) }
      yield* pointsIn(item.children, depth + 1)
    }
  }
}

/**
 * Every point of every list in the texts, in the order they are drawn, each nested one a
 * point of its own: the tree `RichText` draws them from, so what is offered is what is seen.
 */
export function listPoints(texts: readonly string[]): ListPoint[] {
  return texts.flatMap((text) => [...pointsIn(parseRichText(text), 0)])
}

/**
 * How two texts are the same step: the same words with the same case, whatever spaces and
 * line breaks stand between them.
 */
const sameStep = (text: string) => text.trim().replaceAll(/\s+/gu, ' ')

/**
 * A step's length as the server counts it: in code points, as Python's `len` does, not in
 * UTF-16 units and not in what a reader sees as one character.
 */
const length = (text: string) => Array.from(text).length

export function standings(
  points: readonly ListPoint[],
  steps: readonly { text: string }[],
): PointStanding[] {
  const had = new Set(steps.map((step) => sameStep(step.text)))
  const seen = new Set<string>()
  return points.map((point) => {
    const key = sameStep(point.source)
    let bar: PointBar | null = null
    if (had.has(key)) bar = 'exists'
    else if (seen.has(key)) bar = 'repeat'
    else if (length(point.source) > MAX_STEP_TEXT) bar = 'long'
    seen.add(key)
    return { bar, point }
  })
}

/** The checklist to send: every step the item has, by its id, and the chosen points after. */
export function checklistWith(steps: readonly { id: string; text: string }[], added: string[]) {
  return [...steps.map(({ id, text }) => ({ id, text })), ...added]
}
