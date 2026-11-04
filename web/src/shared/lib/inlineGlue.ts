/**
 * A reference with the characters written against it, held as one piece.
 *
 * A reference is drawn as a button, and a button is an atomic box: a line may break
 * on either side of it, even where no space was written. So «MAIN-12, план» could
 * leave the comma at the start of the next line, cut from the number it follows.
 * What touches a reference with no space between — a comma after it, a bracket or
 * a quote around it — goes with it here, and the renderer keeps the piece on one
 * line wherever it fits on one.
 */
import type { RichInline } from '@/shared/lib/richText.ts'

type ReferenceNode = Extract<RichInline, { kind: 'reference' }>

export type GluedInline =
  | Exclude<RichInline, ReferenceNode>
  | {
      /** What is written right after it, with no space between. */
      after: string
      /** What is written right before the reference, with no space between. */
      before: string
      /** Whether anything is written against it at all. */
      glued: boolean
      kind: 'glued'
      node: ReferenceNode
    }

const LEADING = /^\S+/u
const TRAILING = /\S+$/u

/** Take the characters at the end of the last piece, when it is text, off it. */
function takeTrailing(pieces: GluedInline[]): string {
  const previous = pieces.at(-1)
  if (previous?.kind !== 'text') return ''
  const taken = TRAILING.exec(previous.text)?.[0] ?? ''
  const rest = previous.text.slice(0, previous.text.length - taken.length)
  pieces.splice(-1, 1, ...(rest ? [{ kind: 'text' as const, text: rest }] : []))
  return taken
}

/** The nodes with each reference taking the characters written against it from its neighbours. */
export function glueReferences(nodes: readonly RichInline[]): GluedInline[] {
  const pieces: GluedInline[] = []
  /** How much of the next text the last reference took. */
  let taken = 0
  for (const [index, node] of nodes.entries()) {
    const skip = taken
    taken = 0
    if (node.kind === 'text') {
      const text = node.text.slice(skip)
      if (text) pieces.push({ kind: 'text', text })
    } else if (node.kind === 'reference') {
      const before = takeTrailing(pieces)
      const next = nodes[index + 1]
      const after = next?.kind === 'text' ? (LEADING.exec(next.text)?.[0] ?? '') : ''
      taken = after.length
      pieces.push({ kind: 'glued', node, before, after, glued: Boolean(before || after) })
    } else {
      pieces.push(node)
    }
  }
  return pieces
}
