/**
 * A title cut into the runs a line may break between and the ones it may not.
 *
 * A work-item reference inside a title — «(продолжение MAIN-384)» — is one
 * word to a reader, but its hyphen is a break opportunity to the browser, which
 * set «MAIN-» at the end of one line and «384)» at the start of the next. A
 * reference is its own run, so the host can keep it whole. What counts as a
 * reference is the one reading free text uses (`textReferences.ts`), for
 * identifiers: a long path is many words, and kept whole it would overflow the head.
 *
 * This is the one place a title is cut, for every surface that draws one: the card's head
 * and the hover card draw it through `WorkItemTitle`. A run says what it is by `kind`, so a
 * kind of run a title may come to hold is one more member rather than another flag. The runs
 * joined are the title character for character, so a copied title is the one written.
 */
import { splitIdentifiers } from '@/shared/lib/textReferences.ts'

export interface TitleRun {
  /** `reference`: a work-item reference, which no line break may split; `text`: the rest. */
  kind: 'reference' | 'text'
  /** The run's characters exactly as the title has them. */
  text: string
}

export function titleRuns(title: string): TitleRun[] {
  return splitIdentifiers(title).map((run) =>
    typeof run === 'string' ? { kind: 'text', text: run } : { kind: 'reference', text: run.value },
  )
}
