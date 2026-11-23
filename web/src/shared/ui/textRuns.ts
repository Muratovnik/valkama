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
 *   written between. It breaks at a space and after a `/` as the rest of the line does, and
 *   never after a hyphen: each hyphen is held to the character after it (`.text-code-join`).
 *   Only a word wider than its line breaks inside, where it has to, and never runs past its
 *   box. Its lines are the line's own: a word of code drawn as a box of its own was one line to
 *   a clamp however many it took, and a tile held to three lines grew to six.
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
/** The class that holds a hyphen in code to the character after it (`base.css`). */
const CODE_JOIN = 'text-code-join'

/** The runs as written: code back between its backticks. */
export const writtenText = (runs: readonly TextRun[]) =>
  runs.map((run) => (run.kind === 'code' ? `${TICK}${run.text}${TICK}` : run.text)).join('')

/** The runs as they read on the screen: code without its backticks. */
export const drawnText = (runs: readonly TextRun[]) => runs.map((run) => run.text).join('')

/**
 * The runs before and after the first `at` characters of their text as written, for a line drawn
 * in two parts, as a pair's name is (`PairName`). A run of text the cut falls inside is cut there;
 * a piece of code is never cut, and goes whole to the part it starts in.
 */
export function cutRuns(runs: readonly TextRun[], at: number): [TextRun[], TextRun[]] {
  const before: TextRun[] = []
  const after: TextRun[] = []
  let from = 0
  for (const run of runs) {
    const length = writtenText([run]).length
    const inside = at - from
    if (inside >= length || (run.kind === 'code' && inside > 0)) before.push(run)
    else if (inside <= 0) after.push(run)
    else {
      before.push({ ...run, text: run.text.slice(0, inside) })
      after.push({ ...run, text: run.text.slice(inside) })
    }
    from += length
  }
  return [before, after]
}

/**
 * A sentence of the interface with runs in the place `mark` holds in it, as a filter's chip says
 * «Task: MAIN-12 Raise `X`»: the words around the place are text. `sentence` is the message
 * formatted with `mark` for the value, so the order of its words is the language's.
 */
export function runsWithin(sentence: string, mark: string, runs: readonly TextRun[]): TextRun[] {
  const at = sentence.indexOf(mark)
  if (at < 0) return [{ kind: 'text', text: sentence }]
  const text = (words: string): TextRun[] => (words ? [{ kind: 'text', text: words }] : [])
  return [...text(sentence.slice(0, at)), ...runs, ...text(sentence.slice(at + mark.length))]
}

function element(tag: string, className: string, text = '') {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

/** Code's characters with each run of hyphens held to the character after it, so no line breaks there. */
const joined = (text: string): (Node | string)[] =>
  text
    .split(/(-+[^\s/-])/u)
    .filter(Boolean)
    .map((part) => (/^-+[^\s/-]$/u.test(part) ? element('span', CODE_JOIN, part) : part))

/** A piece of code up to a `/` and the place to break after it, as `slashBreaks.ts` draws one. */
function codePiece(piece: string, last: boolean): (Node | string)[] {
  if (last) return joined(piece)
  const span = element('span', SLASH_BREAK)
  span.replaceChildren(...joined(piece))
  return [span]
}

function code(text: string) {
  const node = element('code', CODE)
  const pieces = slashPieces(text)
  node.replaceChildren(
    ...pieces.flatMap((piece, index) => codePiece(piece, index === pieces.length - 1)),
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
 * what a cut text's whole words are drawn with, so they read as the text they stand for. A line
 * drawn in parts, each in runs of its own, as a pair's name is (`PairName`), is found by its
 * parts' runs in order.
 */
export function runsDrawnIn(anchor: HTMLElement, text: string): readonly TextRun[] | null {
  const hosts = [anchor, ...anchor.querySelectorAll<HTMLElement>(`[${HOST}]`)]
  for (const host of hosts) {
    const runs = drawn.get(host)
    if (runs && writtenText(runs) === text) return runs
  }
  const parts = hosts.flatMap((host) => drawn.get(host) ?? [])
  return parts.length && writtenText(parts) === text ? parts : null
}

/** The element a drawn character belongs to: the runs' host, else its own element. */
export const runsHostOf = (inside: Element) => inside.closest(`[${HOST}]`)

export const vTextRuns: Directive<HTMLElement, readonly TextRun[]> = {
  beforeMount: (host, { value }) => drawRuns(host, value),
  updated: (host, { value }) => drawRuns(host, value),
}
