/**
 * What a reference holds on to: the characters written against it, never a word a
 * space keeps apart, and never the text itself, which reads as it was written.
 */
import { describe, expect, it } from 'vitest'

import { glueReferences } from '@/shared/lib/inlineGlue.ts'
import type { GluedInline } from '@/shared/lib/inlineGlue.ts'
import { parseRichInline } from '@/shared/lib/richText.ts'

/** A piece as text: a glued reference as `before[value]after`, anything else as its words. */
function written(pieces: readonly GluedInline[]): string {
  return pieces
    .map((piece) => {
      if (piece.kind === 'glued')
        return `${piece.before}[${piece.node.reference.value}]${piece.after}`
      return piece.kind === 'text' ? piece.text : `<${piece.kind}>`
    })
    .join('|')
}

describe('a reference and what is written against it', () => {
  it.each([
    ['a comma after it', 'See MAIN-12, plan', 'See |[MAIN-12],| plan'],
    ['brackets around it', 'then (MAIN-14) and', 'then |([MAIN-14])| and'],
    ['quotes and a full stop', 'и «MAIN-15».', 'и |«[MAIN-15]».'],
    ['spaces on both sides', 'a MAIN-12 b', 'a |[MAIN-12]| b'],
    ['the whole text', 'MAIN-12', '[MAIN-12]'],
    ['two with a comma between', 'MAIN-12,MAIN-13 done', '[MAIN-12],|[MAIN-13]| done'],
    ['a path and its tail', 'see docs/plans/x.md: here', 'see |[docs/plans/x.md:]| here'],
  ])('%s', (_name, source, expected) => {
    expect(written(glueReferences(parseRichInline(source)))).toBe(expected)
  })

  it('says whether anything is glued, and leaves the words as they were', () => {
    const source = 'See (MAIN-12), MAIN-13 and *MAIN-14*'
    const pieces = glueReferences(parseRichInline(source))
    const glued = pieces.flatMap((piece) => (piece.kind === 'glued' ? [piece.glued] : []))
    expect(glued).toEqual([true, false])
    // Emphasis is a node of its own: what is inside it is glued there, not here.
    expect(pieces.at(-1)?.kind).toBe('em')
    expect(written(pieces).replaceAll(/[|[\]]/gu, '')).toBe('See (MAIN-12), MAIN-13 and <em>')
  })
})
