/**
 * The hint an element shows under the pointer or the keyboard's focus, for the one tooltip
 * of the window (`TooltipHost`). It takes the place of the `title` attribute, which the
 * browser draws in its own font and colours, late, and never when the text is cut short.
 *
 * The directive files the text against the element and marks it with the words, as
 * `data-tooltip`, and nothing more: no wrapper, no listener, no popup per element. The hint
 * manager (`hintManager.ts`) hears the pointer and the focus for every hint, and finds the marked
 * element through the rules below (`pointerAnchorOf`, `focusAnchorOf`).
 *
 *     <button v-tooltip.name="t('refresh.title')">       an icon's name, always
 *     <a v-tooltip.clipped="name">{{ name }}</a>          only while its text is cut
 *     <time v-tooltip.detail="full">{{ short }}</time>    what the screen does not say, always
 *
 * Every hint states its kind, because the kind is what decides whether it may show at all:
 * - `name` names a control that shows no words, an icon or a glyph, and always shows;
 * - `clipped` is the whole text of an element whose text is cut, and shows only while it is;
 * - `detail` says what is nowhere on the screen. A hint that repeats the words its element
 *   shows is noise over the thing it covers, so `check:ui-system` allows a detail only from
 *   its register, each with its reason, and refuses a hint that states no kind.
 *
 * Where the hint stands is not the call site's to say: its kind and the list its element stands
 * in decide it (`hintPlacement.ts`). An argument, a side (`right`, `left-start`), is read only for
 * an exception `check:ui-system` registers with its reason. `clipped` shows the hint only while
 * the element or something in it has more text than its box shows: an ellipsis, a clamp, or a
 * label hidden for want of room. An empty or absent text shows nothing. Such a hint is not drawn
 * beside its element: its words are laid whole over the cut ones, from their first letter and in
 * their type (`WholeText`), so the text reads on where it was cut. A label hidden whole shows no
 * letter to lay them from, and its hint names its element beside it, placed as a `name` is.
 *
 * The value is the text, or `{ text, note }`: the note is a second line in the quiet ink,
 * a state under an action. The text may run over several lines: a line break in it is kept,
 * each line a fact of its own. `{ text, clipped: true }` holds a detail back until its element
 * is cut, where whether it says anything the screen does not is decided as the page runs.
 *
 * `{ text, words }` is a detail on an element whose own words can be cut: a one-line name
 * that already has something to add. While its words are cut the hint says them whole
 * before the detail, since a cut word is not on the screen; while they are not, the hint is
 * the detail alone. With no detail to add it is the `clipped` hint of its words.
 *
 * `{ text, body }` is a detail with a structure: the host draws the body as a grid of a head
 * row, quiet rows, main rows and notes (`TooltipBody`), its figures and shares in columns of
 * their own, and the text stays what assistive technology is given and the page marks.
 *
 * An element marked `data-tooltip-area` speaks with the one hint it holds: the pointer anywhere
 * in it, and focus a key brings to anything in it, shows that hint, placed against the element
 * that carries it, and moving between its parts leaves the hint as it is. A chart's period is
 * one: the period carries the hint, and its segments, which stand beside it rather than in it
 * so that no control holds another, carry none. A part that stands for a main row of the body
 * names that row's key as `data-tooltip-row`, and the row is marked while the pointer or the
 * keyboard's focus is on that part.
 *
 * An element whose box takes the pointer past its words, as a board tile's open target stretched
 * over the whole tile does, marks the part its words stand in `data-tooltip-words`: the pointer
 * raises their whole words only over that part, and focus a key brings still shows them.
 *
 * For assistive technology it does what `title` did. With nothing else naming the element
 * the hint is its name, as `aria-label`; otherwise it is its description, through
 * `aria-describedby` and a hidden copy of the words the host keeps, unless it says nothing
 * the name does not, which would only be heard twice.
 */
import { shallowReactive } from 'vue'
import type { Directive, DirectiveBinding } from 'vue'

import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import { hintAnchorGone, hintAnchorResized } from '@/shared/ui/hintManager.ts'
import type { Box, HintAlign, HintSide } from '@/shared/ui/hintPlacement.ts'

/** A registered exception's argument: a side, and `-start` to stand level with the element's start. */
type TooltipPlace = HintSide | `${HintSide}-start`

/** What a hint is to its element, which decides when it shows (see above). */
export type TooltipKind = 'name' | 'clipped' | 'detail'

/** A line of a structured hint: a name, with a figure and a share in columns of their own. */
interface TooltipLine {
  name: string
  figure?: string
  share?: string
}

/** A main row of a structured hint: one series, its hue before its name. */
export interface TooltipRow extends TooltipLine {
  /** What the part of the area that stands for this row names as `data-tooltip-row`. */
  key?: string
  /** The hue of its series, as `seriesSlots()` gave it, drawn as the legend's swatch is. */
  slot?: SeriesSlot
}

/**
 * A hint drawn as a grid: what it is about with its figure, quiet rows in the quiet ink, a main
 * row for each part, and notes under the rows, each a line of its own across the whole hint.
 */
export interface TooltipBody {
  head: Omit<TooltipLine, 'share'>
  rows: readonly TooltipRow[]
  notes?: readonly string[]
  quiet?: readonly Omit<TooltipLine, 'share'>[]
}

export type TooltipValue =
  | string
  | {
      text: string | null | undefined
      body?: TooltipBody | null
      clipped?: boolean
      note?: string | null
      words?: string | null
    }
  | null
  | undefined

interface Tooltip {
  /** The side a registered exception writes, or null: the hint stands where its kind puts it. */
  asked: { align: HintAlign; side: HintSide } | null
  /** The text drawn as a grid, or null for the text as it reads. */
  body: TooltipBody | null
  clipped: boolean
  /** The id of the hidden copy that describes the element, while it does. */
  describes: string | null
  kind: TooltipKind
  /** The hint is the element's name, written by this directive. */
  names: boolean
  /** A second line in the quiet ink, or empty. */
  note: string
  text: string
  /** The element's own words, said whole before the text while they are cut, or empty. */
  words: string
}

const SIDES: readonly HintSide[] = ['top', 'right', 'bottom', 'left']
const KINDS: readonly TooltipKind[] = ['name', 'clipped', 'detail']
/** What the elements show, read by the host as it shows and reshown when it changes. */
const tooltips = shallowReactive(new WeakMap<Element, Tooltip>())
/** The hidden copies the host keeps, by id: an element is described by one of them. */
export const tooltipDescriptions = shallowReactive(new Map<string, string>())
let serial = 0

const words = (text: string) =>
  text
    .toLocaleLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter(Boolean)

/**
 * Whether every word of the hint is already said, so a description would repeat it: in the
 * name, or in the value a separator or slider reads out with it.
 */
function repeats(text: string, element: HTMLElement, name: string) {
  const said = new Set(words(`${name} ${element.getAttribute('aria-valuetext') ?? ''}`))
  return words(text).every((word) => said.has(word))
}

/** What names the element apart from this directive, as a browser would find it. */
function nameOf(element: HTMLElement, own: Tooltip | undefined): string {
  const label = own?.names ? '' : (element.getAttribute('aria-label') ?? '').trim()
  if (label) return label
  const labelledBy = (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.querySelector(`#${CSS.escape(id)}`)?.textContent ?? '')
    .join(' ')
    .trim()
  if (labelledBy) return labelledBy
  const labels =
    'labels' in element ? (element.labels as NodeListOf<HTMLLabelElement> | null) : null
  const labelled = [...(labels ?? [])]
    .map((each) => each.textContent ?? '')
    .join(' ')
    .trim()
  return labelled || (element.getAttribute('alt') ?? element.textContent ?? '').trim()
}

function describedBy(element: HTMLElement): string[] {
  return (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
}

function setDescribedBy(element: HTMLElement, ids: string[]) {
  if (ids.length) element.setAttribute('aria-describedby', ids.join(' '))
  else element.removeAttribute('aria-describedby')
}

/**
 * The cut texts' boxes, watched while they hold a hint that shows only while they are cut: a
 * window or a panel that narrows or widens one changes whether it is cut, with no pointer moving.
 */
let resizes: ResizeObserver | null = null

function watchSize(element: HTMLElement, cut: boolean) {
  if (typeof ResizeObserver === 'undefined') return
  resizes ??= new ResizeObserver((entries) => {
    for (const { target } of entries) if (target instanceof HTMLElement) hintAnchorResized(target)
  })
  if (cut) resizes.observe(element)
  else resizes.unobserve(element)
}

function forget(element: HTMLElement) {
  const tooltip = tooltips.get(element)
  if (!tooltip) return
  tooltips.delete(element)
  watchSize(element, false)
  if (tooltip.names) element.removeAttribute('aria-label')
  if (tooltip.describes) {
    tooltipDescriptions.delete(tooltip.describes)
    setDescribedBy(
      element,
      describedBy(element).filter((id) => id !== tooltip.describes),
    )
  }
  delete element.dataset.tooltip
  delete element.dataset.tooltipKind
  hintAnchorGone(element)
}

/** The side a registered exception writes as the argument, or null where none is written. */
function askedOf(arg = ''): Tooltip['asked'] {
  const [written = '', along] = arg.split('-')
  const side = SIDES.find((each) => each === written)
  return side ? { align: along === 'start' ? 'start' : 'center', side } : null
}

function file(
  element: HTMLElement,
  binding: DirectiveBinding<TooltipValue, TooltipKind, TooltipPlace>,
) {
  const { value } = binding
  const parts: Exclude<TooltipValue, string | null | undefined> =
    typeof value === 'object' && value !== null ? value : { text: value }
  const detail = parts.text?.trim() ?? ''
  const own = parts.words?.trim() ?? ''
  // With nothing to add, the element's own words are its hint while they are cut.
  const main = detail || own
  const words = detail ? own : ''
  const note = parts.note?.trim() ?? ''
  // A hint that states no kind shows nothing: the gate refuses one before it gets here.
  const kind = KINDS.find((each) => binding.modifiers[each])
  if (!main || !kind) {
    forget(element)
    return
  }
  // What assistive technology is given and the page marks: both lines, as one text.
  const said = note ? `${main}\n${note}` : main
  const before = tooltips.get(element)
  const clipped = kind === 'clipped' || parts.clipped === true || !detail
  const asked = askedOf(binding.arg)
  const names = before?.names === true || !nameOf(element, before)
  let describes: string | null = null
  if (names) element.setAttribute('aria-label', said)
  else if (!repeats(said, element, nameOf(element, before))) {
    if (!before?.describes) serial += 1
    describes = before?.describes ?? `tooltip-${serial}`
    tooltipDescriptions.set(describes, said)
    // A template that writes the element's own description writes over this id on its next
    // update; the directive's `updated` hook comes after and adds it back.
    const ids = describedBy(element)
    if (!ids.includes(describes)) setDescribedBy(element, [...ids, describes])
  }
  if (before?.describes && before.describes !== describes) {
    tooltipDescriptions.delete(before.describes)
    setDescribedBy(
      element,
      describedBy(element).filter((id) => id !== before.describes),
    )
  }
  element.dataset.tooltip = said
  element.dataset.tooltipKind = kind
  const body = detail ? (parts.body ?? null) : null
  tooltips.set(element, {
    asked,
    body,
    clipped,
    describes,
    kind,
    names,
    note,
    text: main,
    words,
  })
  if (clipped !== before?.clipped) watchSize(element, clipped)
}

export const vTooltip: Directive<HTMLElement, TooltipValue, TooltipKind, TooltipPlace> = {
  mounted: file,
  updated: file,
  beforeUnmount: forget,
}

/** The area the element stands in, which speaks with the one hint it holds, if any. */
const areaOf = (element: Element) => element.closest<HTMLElement>('[data-tooltip-area]')

/** The element an event happened on or in, if it shows a hint: its area's, inside one. */
export function tooltipAnchorOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const area = areaOf(target)
  return area
    ? area.querySelector<HTMLElement>('[data-tooltip]')
    : target.closest<HTMLElement>('[data-tooltip]')
}

/**
 * The element whose hint the pointer on `target` asks for: its own, or, while its own is a
 * `clipped` hint of words that stand whole, the hint of what holds it. A one-line word inside a
 * control that has a hint of its own took the pointer from that hint everywhere it stood whole.
 */
export function pointerAnchorOf(target: EventTarget | null): HTMLElement | null {
  const element = tooltipAnchorOf(target)
  let speaker = element
  while (speaker && tooltipOf(speaker)?.clipped && !textIsClipped(speaker)) {
    const holder = tooltipAnchorOf(speaker.parentElement)
    // Inside an area its one hint holds every part, its own element too.
    if (holder === speaker) break
    speaker = holder
  }
  return speaker ?? element
}

/**
 * The element whose hint focus on `target` shows: its own, or its area's. A control inside a
 * hinted element outside any area shows none: it is not that element.
 */
export function focusAnchorOf(target: EventTarget | null): HTMLElement | null {
  const anchor = tooltipAnchorOf(target)
  if (!anchor || !(target instanceof Element)) return null
  return anchor === target || areaOf(target)?.contains(anchor) ? anchor : null
}

/** The element whose hover holds `anchor`'s hint up: its area, or itself. */
export const tooltipReachOf = (anchor: HTMLElement) => areaOf(anchor) ?? anchor

/**
 * Whether the pointer at `x`, `y` on `anchor` reaches its words: anywhere on it, or only over the
 * part it marks as the one its words stand in (`data-tooltip-words`). Laid over a whole tile from
 * the open target the tile is stretched under, a title's whole words rose wherever the pointer
 * rested on the tile and ran over the neighbouring columns, as if the tile had a hint of its own.
 */
export function onTooltipWords(anchor: HTMLElement, x: number, y: number): boolean {
  const part = anchor.querySelector('[data-tooltip-words]')
  if (!part) return true
  const box = part.getBoundingClientRect()
  return x >= box.left && x < box.right && y >= box.top && y < box.bottom
}

/** Whether the element stands in an area, which speaks with the one hint it holds. */
export const inTooltipArea = (element: Element) => areaOf(element) !== null

/**
 * The key of the main row of `anchor`'s hint that `part` stands for (`data-tooltip-row`): only
 * a part of the area `anchor` speaks for, and none for the area's own ground.
 */
export function tooltipRowOf(anchor: HTMLElement, part: Element | null): string | null {
  const area = areaOf(anchor)
  const row = part?.closest<HTMLElement>('[data-tooltip-row]')
  return area && row && area.contains(row) ? (row.dataset.tooltipRow ?? null) : null
}

/** What the element's hint says and how it shows, read reactively. */
export const tooltipOf = (element: Element) => tooltips.get(element)

/**
 * Whether the element's hint is its own words, shown only while they are cut, which are laid
 * whole over them (`WholeText`) rather than drawn as a hint beside it (`TooltipHost`): while a
 * letter of them is on screen to lay them from (`firstLetterOf`). Words a narrow place hides
 * whole, as an icon rail's labels, are hidden rather than cut, and have nothing to lay them
 * over: the hint names its element beside it, as an icon's name does (`namesHidden`). Laid from
 * the hidden label, they stood over the icon as a block a few letters wide that broke the word.
 */
export const showsWhole = (element: HTMLElement) =>
  tooltipOf(element)?.clipped === true && firstLetterOf(element) !== null

/** Whether the element's hint is its own words that no letter of shows: hidden, not cut. */
export const namesHidden = (element: HTMLElement) =>
  tooltipOf(element)?.clipped === true && firstLetterOf(element) === null

/** Overflow under which a box shows less than it holds. `visible` lets it run on. */
const CUTS = new Set(['hidden', 'clip', 'auto', 'scroll'])
/** How many elements inside a hint's element are looked at: a hint sits on a control. */
const LOOK_AT = 40

/** The text a box shows or cuts, less the shared copy kept for assistive technology. */
function shownText(box: HTMLElement): Text[] {
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
  const found: Text[] = []
  for (let node = walker.nextNode(); node && found.length < LOOK_AT; node = walker.nextNode()) {
    const hidden = node.parentElement?.closest('.visually-hidden')
    if (node.textContent?.trim() && !(hidden && box.contains(hidden))) found.push(node as Text)
  }
  return found
}

/**
 * Whether at least half of a letter, across and down, is on screen: not cut away by a box between
 * it and `element` that shows less than it holds, nor hidden. A label kept for a reader alone is
 * laid out in a box a pixel wide that shows a pixel of its first letter; a word folded onto a
 * line its mark cuts is laid out under it and shows none.
 */
function inSight(letter: DOMRect, inked: Element, element: HTMLElement): boolean {
  if (getComputedStyle(inked).visibility !== 'visible') return false
  let [left, top, right, bottom] = [letter.left, letter.top, letter.right, letter.bottom]
  for (let box: Element | null = inked; box; box = box === element ? null : box.parentElement) {
    const style = getComputedStyle(box)
    const clips = style.clipPath !== 'none'
    if (!clips && !CUTS.has(style.overflowX) && !CUTS.has(style.overflowY)) continue
    const edges = box.getBoundingClientRect()
    if (clips || CUTS.has(style.overflowX)) {
      left = Math.max(left, edges.left + (Number.parseFloat(style.borderLeftWidth) || 0))
      right = Math.min(right, edges.right - (Number.parseFloat(style.borderRightWidth) || 0))
    }
    if (clips || CUTS.has(style.overflowY)) {
      top = Math.max(top, edges.top + (Number.parseFloat(style.borderTopWidth) || 0))
      bottom = Math.min(bottom, edges.bottom - (Number.parseFloat(style.borderBottomWidth) || 0))
    }
  }
  return right - left >= letter.width / 2 && bottom - top >= letter.height / 2
}

/**
 * The first letter of the words the element shows, where it stands, and the element whose type
 * draws it: where the whole of a cut text starts (`WholeText`). Null for an element none of whose
 * words is on screen (`inSight`). Text hidden from assistive technology inside it is a glyph or a
 * shortened form, as a «+» before a label or a shortcut after it, never the words the hint makes
 * whole: laid from the «+» of a hidden «New work», the words stood over the sign.
 */
export function firstLetterOf(element: HTMLElement): { box: DOMRect; inked: Element } | null {
  const range = document.createRange()
  for (const node of shownText(element)) {
    const at = node.data.search(/\S/u)
    const inked = node.parentElement
    if (!inked || at < 0) continue
    const glyph = inked.closest('[aria-hidden="true"]')
    if (glyph && glyph !== element && element.contains(glyph)) continue
    range.setStart(node, at)
    range.setEnd(node, at + 1)
    const box = range.getBoundingClientRect()
    // A text laid out nowhere, as one a closed part holds, is not where the words start. Words
    // laid out and out of sight are where they start, hidden: a count after them is not.
    if (box.width > 0 && box.height > 0) return inSight(box, inked, element) ? { box, inked } : null
  }
  return null
}

/**
 * Whether a box that holds more than it shows hides text by it, `across` or down: a line of
 * its text laid out past the edge it cuts at, its padding box. What it holds past that edge
 * may be no text at all — a press's hit area standing past its words, as `.chart-press` has
 * one 12px to each side and 8px over and under — and that is nothing the hint has to say.
 * Counted, it showed the hint of a table's name that stood whole. The letters of a line stand
 * a little past a box no taller than its leading, so down only a line a quarter past counts.
 */
function hidesText(box: HTMLElement, across: boolean): boolean {
  const style = getComputedStyle(box)
  const edges = box.getBoundingClientRect()
  const inset = (side: 'Left' | 'Right' | 'Top' | 'Bottom') =>
    Number.parseFloat(style[`border${side}Width`]) || 0
  const [start, end] = across
    ? [edges.left + inset('Left'), edges.right - inset('Right')]
    : [edges.top + inset('Top'), edges.bottom - inset('Bottom')]
  const range = document.createRange()
  return shownText(box).some((node) => {
    range.selectNodeContents(node)
    return [...range.getClientRects()].some((line) => {
      const [from, to, size] = across
        ? [line.left, line.right, line.width]
        : [line.top, line.bottom, line.height]
      const slack = across ? 0.5 : Math.max(1, size / 4)
      return size > 0 && (to > end + slack || from < start - slack)
    })
  })
}

/**
 * Whether the element or something in it shows less text than it holds, across or down.
 * Read at the moment the hint would show, so it answers for the width the box has then.
 * A box counts while it holds more than it shows and what it hides is text (`hidesText`).
 *
 * The shared copy for assistive technology (`.visually-hidden`) is never shown, so it is
 * never cut: counted, it held up the hint of every element that keeps one, as a mark whose
 * short words stand on screen keeps its whole words. A label a narrow place hides for want
 * of room is hidden by a rule of its own, and counts: its hint names the element (`namesHidden`).
 */
export function textIsClipped(element: HTMLElement): boolean {
  return boxesOf(element).some((box) => {
    const cut = cutOf(box)
    return cut.across || cut.down
  })
}

/** The element and what it holds, as far as a hint looks. */
const boxesOf = (element: HTMLElement) => [
  element,
  ...[...element.querySelectorAll<HTMLElement>('*')].slice(0, LOOK_AT),
]

/** Whether `box` hides text it holds across or down (`textIsClipped`). */
function cutOf(box: HTMLElement): { across: boolean; down: boolean } {
  if (!box.textContent?.trim() || box.classList.contains('visually-hidden'))
    return { across: false, down: false }
  const style = getComputedStyle(box)
  return {
    across: CUTS.has(style.overflowX) && box.scrollWidth > box.clientWidth && hidesText(box, true),
    down:
      CUTS.has(style.overflowY) && box.scrollHeight > box.clientHeight + 1 && hidesText(box, false),
  }
}

/**
 * The box the lines of a text cut down show in, as a clamp of two lines shows two with an
 * ellipsis ending the second, in the window's coordinates: the content box of each box that cuts
 * the element's text down, together. Null where its text is cut across alone, on its one line.
 * The whole words laid over it cover all of it: laid from the first letter on one line, they
 * left the clamp's second line and its ellipsis showing under them, and the text read twice.
 */
export function cutLinesOf(element: HTMLElement): Box | null {
  let lines: Box | null = null
  for (const box of boxesOf(element)) {
    if (!cutOf(box).down) continue
    const style = getComputedStyle(box)
    const edges = box.getBoundingClientRect()
    // Drawn larger or smaller than its type, as on a zoomed canvas, its insets are too.
    const scale = box.offsetHeight > 0 ? edges.height / box.offsetHeight : 1
    const inset = (side: 'Left' | 'Right' | 'Top' | 'Bottom') =>
      ((Number.parseFloat(style[`border${side}Width`]) || 0) +
        (Number.parseFloat(style[`padding${side}`]) || 0)) *
      scale
    const content = {
      left: edges.left + inset('Left'),
      right: edges.right - inset('Right'),
      top: edges.top + inset('Top'),
      bottom: edges.bottom - inset('Bottom'),
    }
    lines = lines
      ? {
          left: Math.min(lines.left, content.left),
          right: Math.max(lines.right, content.right),
          top: Math.min(lines.top, content.top),
          bottom: Math.max(lines.bottom, content.bottom),
        }
      : content
  }
  return lines
}
