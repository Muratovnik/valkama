/**
 * A title cut into the runs a line may break between and the ones it may not.
 *
 * A work-item reference inside a title — «(продолжение MAIN-384)» — is one
 * word to a reader, but its hyphen is a break opportunity to the browser, which
 * set «MAIN-» at the end of one line and «384)» at the start of the next. A
 * reference is its own run, so the host can keep it whole; the text itself is
 * untouched, so a copied title still names the reference it says. What counts
 * as a reference is the one reading free text uses (`textReferences.ts`), for
 * identifiers: a long path is many words, and kept whole it would overflow the head.
 */
import { splitIdentifiers } from '@/shared/lib/textReferences.ts'

export interface TitleRun {
  text: string
  /** A reference, which no line break may split. */
  whole: boolean
}

export function titleRuns(title: string): TitleRun[] {
  return splitIdentifiers(title).map((run) =>
    typeof run === 'string' ? { text: run, whole: false } : { text: run.value, whole: true },
  )
}
