/**
 * A title cut into the runs a surface draws: code, references and the rest.
 *
 * Code in a title is written between backticks, «Raise `STORE_SCHEMA_VERSION` to 18», and is
 * drawn as code: in the monospace face, without the backticks. The backticks pair from the left,
 * the first with the second and the third with the fourth; a pair with something between them is
 * one code run holding what is between, and an empty pair, or a backtick left without a partner,
 * stays text as written. A reference inside code is part of the code.
 *
 * A work-item reference outside code — «(продолжение MAIN-384)» — is one word to a reader, but
 * its hyphen is a break opportunity to the browser, which set «MAIN-» at the end of one line and
 * «384)» at the start of the next. A reference is its own run, so the surface keeps it whole.
 * What counts as a reference is the one reading free text uses (`textReferences.ts`), for
 * identifiers: a long path is many words, and kept whole it would overflow the head.
 *
 * This is the one place a title is cut, for every surface that draws one: through
 * `vWorkItemTitle`, or by handing these runs to a control that draws any text it is given
 * (`vTextRuns`). `writtenText` gives the runs back as the title was written, backticks included,
 * which is what a copy and every plain-text place (a name, a hint, a download) hold.
 */
import { splitIdentifiers } from '@/shared/lib/textReferences.ts'
import type { TextRun } from '@/shared/ui/textRuns.ts'

export type TitleRun = TextRun

/** Plain text outside code, with its references cut out. */
const prose = (text: string): TitleRun[] =>
  text
    ? splitIdentifiers(text).map((run) =>
        typeof run === 'string'
          ? { kind: 'text', text: run }
          : { kind: 'reference', text: run.value },
      )
    : []

export function titleRuns(title: string): TitleRun[] {
  const runs: TitleRun[] = []
  let text = ''
  let from = 0
  for (;;) {
    const open = title.indexOf('`', from)
    const close = open < 0 ? -1 : title.indexOf('`', open + 1)
    if (close < 0) break
    text += title.slice(from, open)
    if (close === open + 1) text += '``'
    else {
      runs.push(...prose(text), { kind: 'code', text: title.slice(open + 1, close) })
      text = ''
    }
    from = close + 1
  }
  runs.push(...prose(text + title.slice(from)))
  return runs
}

/**
 * A reference and its title on one line, «MAIN-12 · title», as runs: written, it is that line.
 * `joint` is what stands between them, where a surface joins them otherwise, as Analytics names a
 * task «MAIN-12 title» and keeps « · » for the two values of a pair.
 */
export const referencedTitleRuns = (
  reference: string,
  title: string,
  joint = ' · ',
): TitleRun[] => [
  { kind: 'reference', text: reference },
  { kind: 'text', text: joint },
  ...titleRuns(title),
]
