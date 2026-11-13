/**
 * The list's own find: what a typed term matches in a row's words, the order of
 * the matches, and which one stays current while the list changes under it.
 *
 * A long list keeps only its window in the page (`useWindowRows.ts`), so the
 * browser's find reached the rows drawn and nothing else. This find reads the
 * words every row of the list prints, as it prints them, whether it is drawn or
 * not; the page is only where its matches are marked (`listFindRanges.ts`).
 *
 * A term matches as the browser's find matches, in the reader's terms: case
 * does not count, and neither does white space beyond one space. A Latin letter
 * is itself without its marks, so «cafe» finds «café». «ё» is «е», because
 * Russian writes either for it, and a stress written over a Cyrillic vowel does
 * not count, so «заметка» finds «заме́тка». A Cyrillic letter a mark makes is
 * itself, though: «й» is not «и» and «ї» is not «і», and folding every mark
 * away, as the browser does, made «мои» find «мой». A letter written apart from
 * its mark is the letter written whole.
 */

/** Stands between two runs of a row's words, so no match spans two of them. */
export const RUN_BREAK = '\u0000'

/** A text as it is compared, and where each of its characters came from. */
export interface Folded {
  /** Where the source behind each character of `text` ends. */
  ends: number[]
  /** Where it starts. */
  starts: number[]
  text: string
}

/** A character and the marks written after it; a mark with nothing before it alone. */
const CLUSTER = /\P{M}\p{M}*|\p{M}+/gu
const LATIN = /^\p{Script=Latin}/u
const CYRILLIC = /^\p{Script=Cyrillic}/u
const SPACE = /^\s/u
const MARKS = /\p{M}/gu

/** One letter and its marks, as find compares them (see above). */
function foldCluster(cluster: string): string {
  if (LATIN.test(cluster)) return cluster.toLowerCase().normalize('NFD').replaceAll(MARKS, '')
  const composed = cluster.normalize('NFC')
  if (!CYRILLIC.test(composed)) return composed.toLowerCase()
  // The letter with the marks that make it one, «й»; a stress makes none, and goes.
  const letter = String.fromCodePoint(composed.codePointAt(0) ?? 0).toLowerCase()
  return letter === 'ё' ? 'е' : letter
}

/**
 * A text as find compares it (see above). A run of white space is one space and
 * there is none at either edge of a run of words; `RUN_BREAK` stays, so a term
 * never spans two runs.
 */
export function fold(source: string): Folded {
  const folded: Folded = { ends: [], starts: [], text: '' }
  const put = (part: string, start: number, end: number) => {
    folded.text += part
    for (let unit = 0; unit < part.length; unit += 1) {
      folded.starts.push(start)
      folded.ends.push(end)
    }
  }
  // Where a run of spaces began that no word has followed yet; -1 for none.
  let space = -1
  let started = false
  for (const match of source.matchAll(CLUSTER)) {
    const [cluster] = match
    const start = match.index
    const end = start + cluster.length
    if (cluster.startsWith(RUN_BREAK)) {
      put(RUN_BREAK, start, end)
      space = -1
      started = false
    } else if (SPACE.test(cluster)) {
      if (started && space < 0) space = start
    } else {
      if (space >= 0) put(' ', space, space + 1)
      space = -1
      started = true
      put(foldCluster(cluster), start, end)
    }
  }
  return folded
}

/** The term as it is looked for: folded, as one run. */
export function termOf(input: string): string {
  return fold(input.replaceAll(RUN_BREAK, ' ')).text
}

/** Where a folded `term` starts in a folded text, each match after the last one's end. */
export function occurrences(text: string, term: string): number[] {
  const found: number[] = []
  if (!term) return found
  for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + term.length))
    found.push(at)
  return found
}

/** One match: the row it is in, by id and place in the list, and which of the row's it is. */
export interface ListMatch {
  id: string
  /** Its order among the row's own matches. */
  nth: number
  /** The row's place in the list. */
  place: number
}

/**
 * Every match in the list, in the list's order: row by row, and in a row as its
 * words read. `rows` hold each row's folded words, in the list's order.
 */
export function listMatches(
  rows: readonly { id: string; text: string }[],
  term: string,
): ListMatch[] {
  if (!term) return []
  const matches: ListMatch[] = []
  for (const [place, { id, text }] of rows.entries()) {
    const count = occurrences(text, term).length
    for (let nth = 0; nth < count; nth += 1) matches.push({ id, nth, place })
  }
  return matches
}

/** The first match at or after a place in the list, round to the first; -1 with none. */
export function firstFrom(matches: readonly ListMatch[], place: number): number {
  if (!matches.length) return -1
  const at = matches.findIndex((match) => match.place >= place)
  return at < 0 ? 0 : at
}

/**
 * Which match stays current once the matches change, under a new term or a list
 * that changed: the current row's own, at its order among them or its last, while
 * the row still matches; otherwise the first at or after `from`, the place the
 * current row stands or stood at. -1 with no match.
 */
export function keptMatch(
  matches: readonly ListMatch[],
  current: Pick<ListMatch, 'id' | 'nth'> | null,
  from: number,
): number {
  if (current) {
    const first = matches.findIndex((match) => match.id === current.id)
    if (first >= 0) {
      let at = first
      while (at - first < current.nth && matches[at + 1]?.id === current.id) at += 1
      return at
    }
  }
  return firstFrom(matches, from)
}

/** The match `by` steps from `at`, round past either end. */
export function stepMatch(count: number, at: number, by: 1 | -1): number {
  if (!count) return -1
  if (at < 0) return by > 0 ? 0 : count - 1
  return (at + by + count) % count
}
