/**
 * The hint an element shows under the pointer or the keyboard's focus, for the one tooltip
 * of the window (`TooltipHost`). It takes the place of the `title` attribute, which the
 * browser draws in its own font and colours, late, and never when the text is cut short.
 *
 * The directive files the text against the element and marks it with the words, as
 * `data-tooltip`, and nothing more: no wrapper, no listener, no popup per element.
 * `TooltipHost` finds the marked element under the pointer or the focus from listeners of
 * its own, as `ReferencePreview` does.
 *
 *     <button v-tooltip.name="t('refresh.title')">            an icon's name, always, above
 *     <a v-tooltip:right.clipped="name">{{ name }}</a>      only while its text is cut, at the right
 *     <time v-tooltip.detail="full">{{ short }}</time>      what the screen does not say, always
 *
 * Every hint states its kind, because the kind is what decides whether it may show at all:
 * - `name` names a control that shows no words, an icon or a glyph, and always shows;
 * - `clipped` is the whole text of an element whose text is cut, and shows only while it is;
 * - `detail` says what is nowhere on the screen. A hint that repeats the words its element
 *   shows is noise over the thing it covers, so `check:ui-system` allows a detail only from
 *   its register, each with its reason, and refuses a hint that states no kind.
 *
 * The argument is the side it stands on (`top` unless said: `right`, `bottom`, `left`), and
 * the hint moves to the other side where the window has no room. `clipped` shows it only
 * while the element or something in it has more text than its box shows: an ellipsis, a
 * clamp, or a label hidden for want of room. An empty or absent text shows nothing.
 *
 * The value is the text, or `{ text, note }`: the note is a second line in the quiet ink,
 * a state under an action. `{ text, clipped: true }` holds a detail back until its element
 * is cut, where whether it says anything the screen does not is decided as the page runs.
 *
 * `{ text, words }` is a detail on an element whose own words can be cut: a one-line name
 * that already has something to add. While its words are cut the hint says them whole
 * before the detail, since a cut word is not on the screen; while they are not, the hint is
 * the detail alone. With no detail to add it is the `clipped` hint of its words.
 *
 * For assistive technology it does what `title` did. With nothing else naming the element
 * the hint is its name, as `aria-label`; otherwise it is its description, through
 * `aria-describedby` and a hidden copy of the words the host keeps, unless it says nothing
 * the name does not, which would only be heard twice.
 */
import { shallowReactive } from 'vue'
import type { Directive, DirectiveBinding } from 'vue'

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left'

/** What a hint is to its element, which decides when it shows (see above). */
export type TooltipKind = 'name' | 'clipped' | 'detail'

export type TooltipValue =
  | string
  | {
      text: string | null | undefined
      clipped?: boolean
      note?: string | null
      words?: string | null
    }
  | null
  | undefined

interface Tooltip {
  clipped: boolean
  /** The id of the hidden copy that describes the element, while it does. */
  describes: string | null
  kind: TooltipKind
  /** The hint is the element's name, written by this directive. */
  names: boolean
  /** A second line in the quiet ink, or empty. */
  note: string
  side: TooltipSide
  text: string
  /** The element's own words, said whole before the text while they are cut, or empty. */
  words: string
}

const SIDES = new Set<string>(['top', 'right', 'bottom', 'left'])
const KINDS: readonly TooltipKind[] = ['name', 'clipped', 'detail']
/** What the elements show, read by the host as it shows and reshown when it changes. */
const tooltips = shallowReactive(new WeakMap<Element, Tooltip>())
/** The hidden copies the host keeps, by id: an element is described by one of them. */
export const tooltipDescriptions = shallowReactive(new Map<string, string>())
let gone: ((element: HTMLElement) => void) | null = null
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

function forget(element: HTMLElement) {
  const tooltip = tooltips.get(element)
  if (!tooltip) return
  tooltips.delete(element)
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
  // A reference's preview marks the same attribute for the popup library; it keeps it.
  if (!Object.hasOwn(element.dataset, 'referencePreview')) delete element.dataset.graceAreaTrigger
  gone?.(element)
}

function file(
  element: HTMLElement,
  binding: DirectiveBinding<TooltipValue, TooltipKind, TooltipSide>,
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
  const side: TooltipSide = binding.arg && SIDES.has(binding.arg) ? binding.arg : 'top'
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
  // The popup library closes a hint whose pointer, on the hint, stands over another one.
  element.dataset.graceAreaTrigger = ''
  tooltips.set(element, { clipped, describes, kind, names, note, side, text: main, words })
}

export const vTooltip: Directive<HTMLElement, TooltipValue, TooltipKind, TooltipSide> = {
  mounted: file,
  updated: file,
  beforeUnmount: forget,
}

/** The element an event happened on or in, if it shows a hint. */
export function tooltipAnchorOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null
}

/** What the element's hint says and how it shows, read reactively. */
export const tooltipOf = (element: Element) => tooltips.get(element)

/** Hear of an element that stopped showing a hint or left the page; returns the undo. */
export function onTooltipAnchorGone(listen: (element: HTMLElement) => void): () => void {
  gone = listen
  return () => {
    gone = null
  }
}

/** Overflow under which a box shows less than it holds. `visible` lets it run on. */
const CUTS = new Set(['hidden', 'clip', 'auto', 'scroll'])
/** How many elements inside a hint's element are looked at: a hint sits on a control. */
const LOOK_AT = 40

/**
 * Whether the element or something in it shows less text than it holds, across or down.
 * Read at the moment the hint would show, so it answers for the width the box has then.
 *
 * The shared copy for assistive technology (`.visually-hidden`) is never shown, so it is
 * never cut: counted, it held up the hint of every element that keeps one, as a mark whose
 * short words stand on screen keeps its whole words. A label a narrow place hides for want
 * of room is hidden by a rule of its own, and counts.
 */
export function textIsClipped(element: HTMLElement): boolean {
  const boxes = [element, ...[...element.querySelectorAll<HTMLElement>('*')].slice(0, LOOK_AT)]
  return boxes.some((box) => {
    if (!box.textContent?.trim() || box.classList.contains('visually-hidden')) return false
    const style = getComputedStyle(box)
    const across = CUTS.has(style.overflowX) && box.scrollWidth > box.clientWidth
    // A line's box can be a pixel shorter than its letters; only a cut line counts.
    const down = CUTS.has(style.overflowY) && box.scrollHeight > box.clientHeight + 1
    return across || down
  })
}
