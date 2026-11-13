/**
 * Where a term's matches stand in a drawn row of the list, as ranges of its text.
 *
 * Find counts and walks the matches by the words every row prints (`listFind.ts`);
 * the page is only where the drawn ones are marked. A drawn row's words are read
 * from its text as the reader sees it, run by run, as the row's words are read
 * for the count: one run per element that holds words, so no match spans two
 * cells or two marks, a title's pieces after each `/` (`slashBreaks.ts`) as one,
 * and nothing a reader does not see, the words kept for assistive technology
 * alone included.
 */
import { fold, occurrences, RUN_BREAK } from '@/widgets/work-item-views/utils/listFind.ts'

/** Words in the row that are not on screen. */
const UNSEEN = '.visually-hidden, .facet-word-hidden'

/** The text nodes of a row's words, run by run. */
function runsOf(row: Element): Text[][] {
  const runs: Text[][] = []
  let holder: Element | null = null
  const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    const parent = text.parentElement
    if (!parent || parent.closest(UNSEEN)) continue
    const owner = parent.closest(':not(.slash-break)')
    if (owner !== holder) {
      // The white space a template leaves between two elements is no run of words.
      if (!text.data.trim()) continue
      runs.push([])
      holder = owner
    }
    runs.at(-1)?.push(text)
  }
  return runs
}

/** The place in the page of a character of a row's text: its node and the offset in it. */
function placer(nodes: readonly Text[], starts: readonly number[]) {
  return (at: number, end: boolean): [Text, number] => {
    let index = 0
    // The node the character is in; for an end, the node the character before it is in.
    while (index + 1 < nodes.length && starts[index + 1] < at + (end ? 0 : 1)) index += 1
    return [nodes[index], at - starts[index]]
  }
}

/** The ranges a folded `term` matches in a drawn row, in the order its words read. */
export function rangesIn(row: Element, term: string): Range[] {
  const nodes: Text[] = []
  const starts: number[] = []
  let source = ''
  for (const [index, run] of runsOf(row).entries()) {
    if (index) source += RUN_BREAK
    for (const node of run) {
      nodes.push(node)
      starts.push(source.length)
      source += node.data
    }
  }
  const folded = fold(source)
  const place = placer(nodes, starts)
  return occurrences(folded.text, term).map((at) => {
    const range = row.ownerDocument.createRange()
    range.setStart(...place(folded.starts[at], false))
    range.setEnd(...place(folded.ends[at + term.length - 1], true))
    return range
  })
}
