/**
 * A title cut into the runs a line may break between and the ones it may not.
 *
 * A work-item reference inside a title — «(продолжение MAIN-384)» — is one
 * word to a reader, but its hyphen is a break opportunity to the browser, which
 * set «MAIN-» at the end of one line and «384)» at the start of the next. A
 * reference is its own run, so the host can keep it whole; the text itself is
 * untouched, so a copied title still names the reference it says.
 */

/** A reference as the planning model writes one, inside running text. */
const REFERENCE = /\b[A-Z][A-Z0-9]{1,7}-[1-9]\d{0,8}\b/gu

export interface TitleRun {
  text: string
  /** A reference, which no line break may split. */
  whole: boolean
}

export function titleRuns(title: string): TitleRun[] {
  const runs: TitleRun[] = []
  let from = 0
  for (const match of title.matchAll(REFERENCE)) {
    if (match.index > from) runs.push({ text: title.slice(from, match.index), whole: false })
    runs.push({ text: match[0], whole: true })
    from = match.index + match[0].length
  }
  if (from < title.length) runs.push({ text: title.slice(from), whole: false })
  return runs
}
