/**
 * The window's one hint manager: which hover surface shows, against which element, and why.
 *
 * Every surface the pointer or the keyboard raises over an element goes through here, whatever
 * draws it. A kind (`HintKind`) says which element an event's target asks for and whether that
 * element's hint may show now; the surface of the kind draws `shownHint` against its anchor and
 * holds no state of its own. Its rules are one small state machine over the page's own events
 * rather than patches on the order of a popup library's:
 *
 * - The pointer, a mouse or a pen, shows a hint after `REST_MS` on its anchor. While a hint shows,
 *   and for `WARM_MS` after it closes, the next anchor's opens at once and the surface moves to
 *   it, so passing between neighbours never leaves a frame without one. The delay is one for every
 *   kind.
 * - When the pointer leaves the anchor the hint stays `GRACE_MS`, and for as long as the pointer is
 *   on the hint itself (`[data-hint-surface]`): a hint the pointer raised can be entered (WCAG 2.2,
 *   1.4.13). Another anchor takes over at once. A surface that lets the pointer through, as one
 *   following the pointer along a chart does, is never entered, and goes after the same grace.
 * - Focus a key brought (`:focus-visible` after a key, never after a press) shows its anchor's hint
 *   at once. Such a hint is read, never pressed: its surface lets a press through. A key that acts
 *   or dismisses (`ACTING_KEYS`) brings none: the focus the page moves in answer, into a layer it
 *   opened or back to the element a closed one came from, is the page's, and its hint would make
 *   the next Escape close the hint instead of the layer under it.
 * - Escape closes the hint and goes no further; with no hint up it is not touched.
 * - A press closes the hint. Resting on what was pressed brings none back; another anchor, or
 *   another part of an area (`HintKind.isArea`), asks again.
 * - A scroll of anything holding the anchor closes a hint the pointer raised, and when that scroll
 *   ends the anchor under the resting pointer asks again: a resting pointer points at whatever the
 *   scroll brought under it. A hint focus holds stays, since a Tab scrolls what it lands on into
 *   view.
 * - A finger shows none, and nor does a pointer with a button down: it is dragging.
 * - One surface shows at a time, and a surface claimed in `overlayStack` closes it.
 */
import { computed, effectScope, onScopeDispose, shallowRef, watch } from 'vue'

import { overlayTop } from '@/shared/ui/overlayStack.ts'

/** How long the pointer rests on an anchor before its hint shows, in ms. */
const REST_MS = 500
/** How long after a hint closes the next one still opens at once, in ms. */
const WARM_MS = 300
/** How long a hint the pointer raised stays after the pointer leaves its anchor, in ms. */
const GRACE_MS = 120
/** Keys that act on what has focus or dismiss a layer, rather than move focus themselves. */
const ACTING_KEYS = new Set(['Enter', ' ', 'Escape'])

/** How one kind of hint finds its anchors. When any of them shows is the manager's. */
export interface HintKind {
  /** The anchor focus on `target` asks for, or null. */
  focusedAnchor: (target: Element) => HTMLElement | null
  /** Whether the anchor speaks for an area, each part of which asks again after a press. */
  isArea: (anchor: HTMLElement) => boolean
  /** The anchor the pointer on `target` asks for, or null. */
  pointedAnchor: (target: Element) => HTMLElement | null
  /** Whether the anchor's hint may show now: asked as it would open. */
  shows: (anchor: HTMLElement) => boolean
}

/** What raised a hint: the pointer resting on its anchor, or focus a key brought there. */
type Raiser = 'pointer' | 'focus'

interface ShownHint {
  readonly anchor: HTMLElement
  readonly by: Raiser
  readonly kind: string
}

interface Asked {
  anchor: HTMLElement
  kind: string
}

const kinds = new Map<string, HintKind>()
const shown = shallowRef<ShownHint | null>(null)
/** The deepest element the pointer is on, and the one focus is on: where the reader stands. */
const pointed = shallowRef<Element | null>(null)
const focused = shallowRef<Element | null>(null)

/** The hint that shows now, if any: its kind's surface draws it. */
export const shownHint = computed(() => shown.value)
/**
 * Where the pointer is, until focus a key moves takes over; and where focus is. A surface marks
 * the part of its anchor the reader stands on from these.
 */
export const pointedPart = computed(() => pointed.value)
export const focusedPart = computed(() => focused.value)

/** The anchor the pointer is on, as its kind found it, and the element it was found from. */
let hovered: Asked | null = null
let lastTarget: Element | null = null
/** The pointer is on the shown hint itself. */
let onSurface = false
/** The anchor waiting out `REST_MS` under the pointer. */
let pending: Asked | null = null
let restTimer: ReturnType<typeof setTimeout> | undefined
let graceTimer: ReturnType<typeof setTimeout> | undefined
/** Runs for `WARM_MS` after a hint closes: while it does, the next one opens at once. */
let coolTimer: ReturnType<typeof setTimeout> | undefined
/** What a press or Escape closed under the pointer: it stays closed while the pointer rests there. */
let dismissed: { anchor: HTMLElement; part: Element | null } | null = null
/** A key that moves focus, not a press, was the last input: focus that moves is the reader's. */
let keyed = false
/** What scrolled and closed a hint the pointer raised, until its scroll ends. */
let scrolledBy: Node | null = null

const surfaceOf = (target: Element) => target.closest('[data-hint-surface]')
const warm = () => shown.value !== null || coolTimer !== undefined

function stopRest() {
  clearTimeout(restTimer)
  restTimer = undefined
  pending = null
}

function stopGrace() {
  clearTimeout(graceTimer)
  graceTimer = undefined
}

function resolve(target: EventTarget | null, by: Raiser): Asked | null {
  if (!(target instanceof Element)) return null
  for (const [kind, rules] of kinds) {
    const anchor = by === 'pointer' ? rules.pointedAnchor(target) : rules.focusedAnchor(target)
    if (anchor) return { kind, anchor }
  }
  return null
}

/**
 * Shows `asked`'s hint now, raised `by` the pointer or focus, if its kind lets it show. One that
 * does not show leaves the shown hint to its own grace: the pointer moving from a cut name onto a
 * whole one once kept the cut one's hint up for as long as it rested there.
 */
function open(asked: Asked, by: Raiser) {
  const rules = kinds.get(asked.kind)
  if (!rules || !asked.anchor.isConnected || !rules.shows(asked.anchor)) return
  stopRest()
  stopGrace()
  clearTimeout(coolTimer)
  coolTimer = undefined
  const now = shown.value
  if (now?.anchor === asked.anchor && now.kind === asked.kind && now.by === by) return
  shown.value = { ...asked, by }
}

function close() {
  stopRest()
  stopGrace()
  if (!shown.value) return
  shown.value = null
  onSurface = false
  clearTimeout(coolTimer)
  coolTimer = setTimeout(() => {
    coolTimer = undefined
  }, WARM_MS)
}

/** The pointer left what held a hint it raised: the hint stays `GRACE_MS`, or while it is entered. */
function startGrace() {
  if (graceTimer !== undefined || shown.value?.by !== 'pointer') return
  graceTimer = setTimeout(() => {
    graceTimer = undefined
    const now = shown.value
    if (now?.by === 'pointer' && !onSurface && hovered?.anchor !== now.anchor) close()
  }, GRACE_MS)
}

/** The pointer is on `asked` from now on: it asks for its hint, at once while one is warm. */
function enter(asked: Asked) {
  if (dismissed?.anchor === asked.anchor || scrolledBy) return
  if (shown.value?.anchor === asked.anchor) {
    stopGrace()
    return
  }
  if (warm()) {
    open(asked, 'pointer')
    return
  }
  stopRest()
  pending = asked
  restTimer = setTimeout(() => {
    restTimer = undefined
    const waited = pending
    pending = null
    if (waited && hovered?.anchor === waited.anchor) open(waited, 'pointer')
  }, REST_MS)
}

function leave() {
  const left = hovered
  hovered = null
  if (!left) return
  if (dismissed?.anchor === left.anchor) dismissed = null
  if (pending?.anchor === left.anchor) stopRest()
  if (shown.value?.anchor === left.anchor) startGrace()
}

/** The pointer moved, or a scroll or a change of the page put another element under it. */
function point(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  const target = event.target instanceof Element ? event.target : null
  const moved = event.type === 'pointermove'
  pointed.value = target
  if (event.buttons !== 0) {
    drag()
    return
  }
  if (moved && scrolledBy && (event.movementX || event.movementY)) resume()
  // A move within the element already heard changes nothing else; anchors are found on arrival.
  if (moved && target === lastTarget) return
  lastTarget = target
  arrive(target)
}

/** A button is down: the pointer is dragging, and shows no hint. */
function drag() {
  stopRest()
  if (shown.value?.by === 'pointer') close()
}

/** The pointer moved after a scroll, so it no longer rests under what the scroll brought there. */
function resume() {
  scrolledBy = null
  if (hovered) enter(hovered)
}

/** The pointer is on `target` now: on the hint itself, on an anchor, or on neither. */
function arrive(target: Element | null) {
  if (target && surfaceOf(target)) {
    leave()
    onSurface = true
    stopGrace()
    return
  }
  onSurface = false
  const asked = target ? resolve(target, 'pointer') : null
  if (asked && asked.anchor === hovered?.anchor) {
    askAgain(asked, target)
    return
  }
  leave()
  if (!asked) {
    startGrace()
    return
  }
  hovered = asked
  enter(asked)
}

/** Another part of the area whose hint a press or Escape closed asks for it again. */
function askAgain(asked: Asked, part: Element | null) {
  if (dismissed?.anchor !== asked.anchor || part === dismissed.part) return
  if (!kinds.get(asked.kind)?.isArea(asked.anchor)) return
  dismissed = null
  enter(asked)
}

function pointerOut(event: PointerEvent) {
  if (event.pointerType === 'touch' || event.relatedTarget !== null) return
  // Out of the window: nothing on the page is under the pointer any more.
  pointed.value = null
  lastTarget = null
  onSurface = false
  leave()
  startGrace()
}

function press(event: PointerEvent) {
  keyed = false
  if (hovered && event.target instanceof Element)
    dismissed = { anchor: hovered.anchor, part: event.target }
  stopRest()
  close()
}

function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || !shown.value) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (hovered) dismissed = { anchor: hovered.anchor, part: pointed.value }
  close()
}

function focusIn(event: FocusEvent) {
  const target = event.target instanceof Element ? event.target : null
  focused.value = target
  if (!keyed || !target) return
  // Focus a key moved is where the reader stands now, not where the pointer rests.
  pointed.value = null
  if (!target.matches(':focus-visible')) return
  const asked = resolve(target, 'focus')
  if (asked) open(asked, 'focus')
}

function focusOut(event: FocusEvent) {
  focused.value = null
  const now = shown.value
  if (now?.by !== 'focus' || resolve(event.target, 'focus')?.anchor !== now.anchor) return
  // Focus moving among the parts of the anchor's area keeps its hint where it stands.
  if (resolve(event.relatedTarget, 'focus')?.anchor !== now.anchor) close()
}

function scrolled(event: Event) {
  const scroller = event.target
  if (!(scroller instanceof Node)) return
  const now = shown.value
  if (now?.by === 'pointer' && scroller.contains(now.anchor)) {
    close()
    scrolledBy = scroller
  } else if (pending && scroller.contains(pending.anchor)) {
    stopRest()
    scrolledBy = scroller
  }
}

function scrollEnded(event: Event) {
  if (!scrolledBy || event.target !== scrolledBy) return
  scrolledBy = null
  if (hovered?.anchor.isConnected) enter(hovered)
}

/** Closes whatever hint shows: another surface took the reader, or its anchor went. */
export function closeHint() {
  close()
}

/** An anchor left the page or stopped asking for a hint. */
export function hintAnchorGone(anchor: HTMLElement) {
  if (hovered?.anchor === anchor) hovered = null
  if (pending?.anchor === anchor) stopRest()
  if (dismissed?.anchor === anchor) dismissed = null
  if (shown.value?.anchor === anchor) close()
}

function listen(): () => void {
  const listening = new AbortController()
  const { signal } = listening
  const captured = { capture: true, signal }
  const quietly = { capture: true, passive: true, signal }
  document.addEventListener('pointerover', point, captured)
  document.addEventListener('pointermove', point, captured)
  document.addEventListener('pointerout', pointerOut, captured)
  document.addEventListener('pointerdown', press, captured)
  document.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      keyed = !ACTING_KEYS.has(event.key)
    },
    captured,
  )
  // At the window, ahead of every listener on the page, so the key goes no further.
  window.addEventListener('keydown', escape, captured)
  document.addEventListener('focusin', focusIn, { signal })
  document.addEventListener('focusout', focusOut, { signal })
  document.addEventListener('scroll', scrolled, quietly)
  document.addEventListener('scrollend', scrollEnded, quietly)
  const scope = effectScope(true)
  scope.run(() => watch(overlayTop, close))
  return () => {
    listening.abort()
    scope.stop()
  }
}

function reset() {
  stopRest()
  stopGrace()
  clearTimeout(coolTimer)
  coolTimer = undefined
  shown.value = null
  pointed.value = null
  focused.value = null
  hovered = null
  lastTarget = null
  onSurface = false
  dismissed = null
  keyed = false
  scrolledBy = null
}

let hosts = 0
let stopListening: (() => void) | null = null

/**
 * Takes part in the manager for the life of the calling component, as the surface of `name`:
 * the first such surface starts the page's listeners, and the last to go stops them.
 */
export function useHintKind(name: string, rules: HintKind) {
  kinds.set(name, rules)
  hosts += 1
  if (hosts === 1) stopListening = listen()
  onScopeDispose(() => {
    kinds.delete(name)
    if (shown.value?.kind === name) close()
    hosts -= 1
    if (hosts > 0) return
    stopListening?.()
    stopListening = null
    reset()
  })
}
