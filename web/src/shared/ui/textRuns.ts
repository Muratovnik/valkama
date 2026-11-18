/**
 * A line of words drawn as runs: plain text, a reference no line breaks inside, and code.
 *
 * What a text is made of is decided by whoever owns it — a work item's title is cut by
 * `titleRuns` — and this draws the runs it is handed, the same way on every surface. A surface
 * that draws any text of its own (a command list, a choice list) takes runs from its caller
 * rather than cutting every string it is given.
 *
 * - text breaks at a space, after a hyphen and after each `/` (`slashBreaks.ts`);
 * - a reference is one word to a reader, so no line break falls at its hyphen;
 * - code is set in the monospace face (`code` in `base.css`), without the backticks it was
 *   written between. Each of its words is a box of its own (`.whole-word`), so it does not break
 *   at a hyphen, and it breaks after a `/` as the rest of the line does; only a word wider than
 *   its line breaks inside, where it has to, and never runs past its box.
 *
 * A selection copied is the text as written: each piece of code drawn here that the selection
 * holds whole goes to the clipboard between its backticks again. The page holds no
 * backtick to select: a mark kept in the page with no size was refused by the type ramp, and one
 * clipped to no width is left out of a selection's copy by the browser.
 *
 * The element it sits on holds the runs and nothing else, and says so with `data-text-runs`:
 * what reads a drawn line back (the list's find, the whole words a cut text shows) finds its
 * runs there.
 */
import type { Directive } from 'vue'

import { SLASH_BREAK, slashNodes, slashPieces } from '@/shared/ui/slashBreaks.ts'

export interface TextRun {
  /**
   * `code`: set as code, its `text` without the backticks it was written between;
   * `reference`: an identifier no line break may split; `text`: the rest.
   */
  kind: 'code' | 'reference' | 'text'
  /** The run's characters as they are drawn. */
  text: string
}

/** The mark code is written between. */
const TICK = '`'
/** The attribute that marks an element whose content these runs are. */
const HOST = 'data-text-runs'
/** The class of a code run's element. */
const CODE = 'text-code'

/** The runs as written: code back between its backticks. */
export const writtenText = (runs: readonly TextRun[]) =>
  runs.map((run) => (run.kind === 'code' ? `${TICK}${run.text}${TICK}` : run.text)).join('')

/** The runs as they read on the screen: code without its backticks. */
export const drawnText = (runs: readonly TextRun[]) => runs.map((run) => run.text).join('')

function element(tag: string, className: string, text = '') {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

/** A word of code: a box for each piece up to a `/`, and a place to break after each. */
const codeWord = (word: string) =>
  slashPieces(word).flatMap((piece, index) => [
    ...(index ? [element('span', SLASH_BREAK)] : []),
    element('span', 'whole-word', piece),
  ])

function code(text: string) {
  const node = element('code', CODE)
  node.replaceChildren(
    ...text
      .split(/(\s+)/u)
      .filter(Boolean)
      .flatMap((piece): (Node | string)[] => (/^\s+$/u.test(piece) ? [piece] : codeWord(piece))),
  )
  return node
}

function nodesOf(run: TextRun): (Node | string)[] {
  if (run.kind === 'code') return [code(run.text)]
  if (run.kind === 'reference') return [element('span', 'text-reference', run.text)]
  return slashNodes(run.text)
}

/** Whether `range` holds all of `node`'s content. */
function holdsWhole(range: Range, node: Node) {
  const whole = document.createRange()
  whole.selectNodeContents(node)
  return (
    range.compareBoundaryPoints(Range.START_TO_START, whole) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, whole) >= 0
  )
}

/** The place just before `node`, or just after it. */
function beside(node: Node, after: boolean): [Node, number] {
  const parent = node.parentNode ?? node
  return [parent, [...parent.childNodes].indexOf(node as ChildNode) + (after ? 1 : 0)]
}

/**
 * A copy of the selection as written: each piece of code drawn in runs that it holds whole goes
 * between its backticks. The words around them are the browser's own reading of the selection,
 * taken a stretch at a time, so lines and spaces copy as they would without code; a selection
 * that holds no piece of code whole is left to the browser.
 *
 * One listener on the document rather than one on each element: the browser sends a copy to the
 * element where the selection starts once it has settled, which for a whole title is often the
 * heading that holds the element rather than the element.
 */
function copyWritten(event: ClipboardEvent) {
  const selection = document.getSelection()
  if (!event.clipboardData || selection?.rangeCount !== 1) return
  const range = selection.getRangeAt(0)
  if (range.collapsed) return
  const codes = [...document.querySelectorAll(`[${HOST}] code.${CODE}`)].filter(
    (node) => range.intersectsNode(node) && holdsWhole(range, node),
  )
  if (!codes.length) return
  const parts: string[] = []
  const read = (from: [Node, number], to: [Node, number]) => {
    const stretch = document.createRange()
    stretch.setStart(...from)
    stretch.setEnd(...to)
    selection.removeAllRanges()
    selection.addRange(stretch)
    parts.push(selection.toString())
  }
  let from: [Node, number] = [range.startContainer, range.startOffset]
  for (const code of codes) {
    read(from, beside(code, false))
    read(beside(code, false), beside(code, true))
    parts.splice(-1, 1, `${TICK}${parts.at(-1) ?? ''}${TICK}`)
    from = beside(code, true)
  }
  read(from, [range.endContainer, range.endOffset])
  selection.removeAllRanges()
  selection.addRange(range)
  event.clipboardData.setData('text/plain', parts.join(''))
  event.preventDefault()
}

let listening = false

/** What the element was last drawn with, so the same runs are not drawn again. */
const drawn = new WeakMap<HTMLElement, readonly TextRun[]>()

const same = (one: readonly TextRun[], other: readonly TextRun[]) =>
  one.length === other.length &&
  one.every((run, index) => run.kind === other[index].kind && run.text === other[index].text)

/** Draws `runs` as the whole content of `host`. */
export function drawRuns(host: HTMLElement, runs: readonly TextRun[]) {
  const before = drawn.get(host)
  if (before && same(before, runs)) return
  if (!before) host.setAttribute(HOST, '')
  if (!listening) {
    listening = true
    document.addEventListener('copy', copyWritten)
  }
  drawn.set(host, runs)
  host.replaceChildren(...runs.flatMap((run) => nodesOf(run)))
}

/**
 * The runs drawn in `anchor` or in an element inside it whose words as written are `text`:
 * what a cut text's whole words are drawn with, so they read as the text they stand for.
 */
export function runsDrawnIn(anchor: HTMLElement, text: string): readonly TextRun[] | null {
  const hosts = [anchor, ...anchor.querySelectorAll<HTMLElement>(`[${HOST}]`)]
  for (const host of hosts) {
    const runs = drawn.get(host)
    if (runs && writtenText(runs) === text) return runs
  }
  return null
}

/** The element a drawn character belongs to: the runs' host, else its own element. */
export const runsHostOf = (inside: Element) => inside.closest(`[${HOST}]`)

export const vTextRuns: Directive<HTMLElement, readonly TextRun[]> = {
  beforeMount: (host, { value }) => drawRuns(host, value),
  updated: (host, { value }) => drawRuns(host, value),
}
