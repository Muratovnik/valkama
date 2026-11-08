/**
 * The hint an element shows under the pointer or the keyboard's focus, for the one tooltip
 * of the window (`TooltipHost`). It takes the place of the `title` attribute, which the
 * browser draws in its own font and colours, late, and never when the text is cut short.
 *
 * The directive files the text against the element and marks it, and nothing more: no
 * wrapper, no listener, no popup per element. `TooltipHost` finds the marked element under
 * the pointer or the focus from listeners of its own, as `ReferencePreview` does.
 *
 *     <button v-tooltip="t('refresh.title')">              always, above
 *     <a v-tooltip:right.clipped="name">{{ name }}</a>     only while its text is cut, at the right
 *     <a v-tooltip="{ text: hint, clipped: !muted }">      the mode decided as the page runs
 *
 * The argument is the side it stands on (`top` unless said: `right`, `bottom`, `left`), and
 * the hint moves to the other side where the window has no room. `clipped` shows it only
 * while the element or something in it has more text than its box shows: an ellipsis, a
 * clamp, or a label hidden for want of room. An empty or absent text shows nothing.
 *
 * For assistive technology it does what `title` did. With nothing else naming the element
 * the hint is its name, as `aria-label`; otherwise it is its description, through
 * `aria-describedby` and a hidden copy of the words the host keeps, unless it says nothing
 * the name does not, which would only be heard twice.
 */
import { shallowReactive } from 'vue'
import type { Directive, DirectiveBinding } from 'vue'

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left'

export type TooltipValue =
  string | { text: string | null | undefined; clipped?: boolean } | null | undefined

interface Tooltip {
  clipped: boolean
  /** The id of the hidden copy that describes the element, while it does. */
  describes: string | null
  /** The hint is the element's name, written by this directive. */
  names: boolean
  side: TooltipSide
  text: string
}

const SIDES = new Set<string>(['top', 'right', 'bottom', 'left'])
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

/** Whether every word of the hint is already in the name, so a description would repeat it. */
function repeats(text: string, name: string) {
  const named = new Set(words(name))
  return words(text).every((word) => named.has(word))
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
  // A reference's preview marks the same attribute for the popup library; it keeps it.
  if (!Object.hasOwn(element.dataset, 'referencePreview')) delete element.dataset.graceAreaTrigger
  gone?.(element)
}

function file(
  element: HTMLElement,
  binding: DirectiveBinding<TooltipValue, 'clipped', TooltipSide>,
) {
  const { value } = binding
  const text = (typeof value === 'object' && value !== null ? value.text : value) ?? ''
  if (!text.trim()) {
    forget(element)
    return
  }
  const before = tooltips.get(element)
  const clipped =
    typeof value === 'object' && value !== null && value.clipped !== undefined
      ? value.clipped
      : Boolean(binding.modifiers.clipped)
  const side: TooltipSide = binding.arg && SIDES.has(binding.arg) ? binding.arg : 'top'
  const names = before?.names === true || !nameOf(element, before)
  let describes: string | null = null
  if (names) element.setAttribute('aria-label', text)
  else if (!repeats(text, nameOf(element, before))) {
    if (!before?.describes) serial += 1
    describes = before?.describes ?? `tooltip-${serial}`
    tooltipDescriptions.set(describes, text)
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
  element.dataset.tooltip = ''
  // The popup library closes a hint whose pointer, on the hint, stands over another one.
  element.dataset.graceAreaTrigger = ''
  tooltips.set(element, { clipped, describes, names, side, text })
}

export const vTooltip: Directive<HTMLElement, TooltipValue, 'clipped', TooltipSide> = {
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
 */
export function textIsClipped(element: HTMLElement): boolean {
  const boxes = [element, ...[...element.querySelectorAll<HTMLElement>('*')].slice(0, LOOK_AT)]
  return boxes.some((box) => {
    if (!box.textContent?.trim()) return false
    const style = getComputedStyle(box)
    const across = CUTS.has(style.overflowX) && box.scrollWidth > box.clientWidth
    // A line's box can be a pixel shorter than its letters; only a cut line counts.
    const down = CUTS.has(style.overflowY) && box.scrollHeight > box.clientHeight + 1
    return across || down
  })
}
