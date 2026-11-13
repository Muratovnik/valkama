/**
 * The list's own find, in place of the browser's.
 *
 * A long list keeps only its window in the page (`useWindowRows.ts`), and the
 * browser's find reached the thirty rows drawn there and nothing else. So while
 * the list is what the page shows, Ctrl+F (⌘F) opens the list's bar instead:
 * the term is looked for in the words every row of the list prints, as the row
 * prints them at this width and in this language, drawn or not (`listFind.ts`).
 * Enter and Shift+Enter, F3 and Shift+F3 go to the next and the previous match,
 * round past either end; going to one the window does not hold brings its row to
 * the middle of the room under the head, and the drawn rows mark every match,
 * the current one apart (`listFindRanges.ts`). Escape closes the bar and gives
 * focus back to where it was, without scrolling the list back to it.
 *
 * The keys are the list's only while nothing lies over it: with a card, a
 * dialog or the finder open, or a menu or a choice list, Ctrl+F is the
 * browser's again, as it is on every other screen. Ctrl+F is the key that types
 * F, wherever the layout has put it; only a layout that types no Latin letter
 * there, such as Russian, is read by the key's place.
 *
 * The count and the current match follow the list as it changes: a row the
 * stream changed, a filter or an order. The current match stays on its row while
 * the row still matches, and the view stays where it is; only the reader's own
 * step, a term typed or the bar opened, moves the list.
 *
 * A closed bar costs nothing: no words are read, nothing is observed or marked.
 */
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { useEventListener, useMutationObserver } from '@vueuse/core'

import {
  fold,
  keptMatch,
  listMatches,
  RUN_BREAK,
  stepMatch,
  termOf,
} from '@/widgets/work-item-views/utils/listFind.ts'
import type { ListMatch } from '@/widgets/work-item-views/utils/listFind.ts'
import { rangesIn } from '@/widgets/work-item-views/utils/listFindRanges.ts'

import { overlayTop, popupOpen } from '@/shared/ui/overlayStack.ts'

/** The names `base.css` styles the matches by: every match, and the current one. */
const MATCHES = 'list-find'
const CURRENT = 'list-find-current'
/** A selection longer than this is no term; the bar keeps the last one instead. */
const PICKED_MAX = 120

const ROWS = 'tbody tr.list-row:not(.list-row-held)'
const LATIN_LETTER = /^\p{Script=Latin}$/u

/** Whether a key is F: by the letter it types, or by its place where it types no Latin one. */
function isF(event: KeyboardEvent): boolean {
  return LATIN_LETTER.test(event.key) ? event.key.toLowerCase() === 'f' : event.code === 'KeyF'
}

interface ListFind<Row> {
  list: { center: (index: number) => void; placeOf: (id: string) => number }
  /** The element that scrolls the rows. */
  root: Readonly<Ref<HTMLElement | null>>
  /** The bar while it is open, for the room it covers. */
  bar: () => HTMLElement | null
  /** Put focus in the bar's field with its text selected. */
  focusBar: () => void
  key: (row: Row) => string
  rows: () => readonly Row[]
  /** The words a row prints, run by run, as it prints them. */
  words: (row: Row) => readonly string[]
}

const highlights = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function'
    ? CSS.highlights
    : null

function unpaint() {
  highlights()?.delete(MATCHES)
  highlights()?.delete(CURRENT)
}

interface Drawn {
  /** The current match, where its row is drawn. */
  found: Range | null
  others: readonly Range[]
}
const NONE_DRAWN: Drawn = { found: null, others: [] }

/** The matches the list's drawn rows hold: the current one, and every other. */
function drawnMatches(element: HTMLElement, term: string, now: ListMatch | null): Drawn {
  const others: Range[] = []
  let found: Range | null = null
  for (const row of element.querySelectorAll(ROWS)) {
    const id = row.querySelector<HTMLElement>('.list-open')?.dataset.id
    for (const [nth, range] of rangesIn(row, term).entries()) {
      if (now && id === now.id && nth === now.nth) found = range
      else others.push(range)
    }
  }
  return { found, others }
}

/** Text selected on the page, as a term: one line, short enough to be one. */
function picked(): string {
  const text = globalThis.getSelection?.()?.toString().trim() ?? ''
  return text && !/[\n\r]/u.test(text) && text.length <= PICKED_MAX ? text : ''
}

export function useListFind<Row>({ bar, focusBar, key, list, root, rows, words }: ListFind<Row>) {
  const open = shallowRef(false)
  /** What is typed in the bar, kept while it is closed for the next opening. */
  const input = shallowRef('')
  const term = computed(() => (open.value ? termOf(input.value) : ''))
  const current = shallowRef<ListMatch | null>(null)
  /** Where focus was when the bar opened, to give it back. */
  let returnTo: HTMLElement | null = null

  const texts = computed(() =>
    term.value
      ? rows().map((row) => ({ id: key(row), text: fold(words(row).join(RUN_BREAK)).text }))
      : [],
  )
  const matches = computed(() => listMatches(texts.value, term.value))
  const at = computed(() => {
    const now = current.value
    return now ? matches.value.findIndex((one) => one.id === now.id && one.nth === now.nth) : -1
  })

  /** The place of the first drawn row whose words are in sight under the head. */
  function firstInView(): number {
    const element = root.value
    if (!element) return 0
    const head = element.querySelector('th.list-head')?.getBoundingClientRect().bottom ?? 0
    for (const row of element.querySelectorAll(ROWS)) {
      if (row.getBoundingClientRect().bottom <= head) continue
      const id = row.querySelector<HTMLElement>('.list-open')?.dataset.id
      const place = id === undefined ? -1 : list.placeOf(id)
      if (place >= 0) return place
    }
    return 0
  }

  // The list or the term changed: stay on the current row while it matches, or go on
  // from where it stands, or stood.
  function standing(now: ListMatch | null): number {
    if (!now) return firstInView()
    const stands = list.placeOf(now.id)
    return stands < 0 ? now.place : stands
  }
  watch(matches, (next) => {
    const now = current.value
    const index = keptMatch(next, now, standing(now))
    current.value = index < 0 ? null : next[index]
  })

  /** Marks the matches in the drawn rows, and says where the current one is drawn. */
  function paint(): Range | null {
    const element = root.value
    const { found, others } =
      element && term.value ? drawnMatches(element, term.value, current.value) : NONE_DRAWN
    const registry = highlights()
    if (registry) {
      registry.set(MATCHES, new Highlight(...others))
      const mark = new Highlight(...(found ? [found] : []))
      // Over every match, wherever two would meet.
      mark.priority = 1
      registry.set(CURRENT, mark)
    }
    return found
  }

  /** Whether a match stands whole in the room under the head, clear of the bar. */
  function inSight(range: Range): boolean {
    const element = root.value
    if (!element) return false
    const box = range.getBoundingClientRect()
    const frame = element.getBoundingClientRect()
    const top = frame.top + element.clientTop
    const left = frame.left + element.clientLeft
    const head = element.querySelector('th.list-head')?.getBoundingClientRect().bottom ?? top
    const cover = bar()?.getBoundingClientRect()
    const covered =
      cover !== undefined &&
      box.top < cover.bottom &&
      box.bottom > cover.top &&
      box.left < cover.right &&
      box.right > cover.left
    return (
      box.height > 0 &&
      !covered &&
      box.top >= head &&
      box.bottom <= top + element.clientHeight &&
      box.left >= left &&
      box.right <= left + element.clientWidth
    )
  }

  /** Brings the current match into sight, once the matches have caught up with the step. */
  async function reveal() {
    await nextTick()
    const range = paint()
    const now = current.value
    if (now && !(range && inSight(range))) list.center(now.place)
  }

  // The rows drawn change as the list scrolls, as a row changes and as the window
  // moves: the marks follow them, for as long as there is a term.
  useMutationObserver(
    () => (term.value ? (root.value?.querySelector('tbody') ?? null) : null),
    paint,
    {
      characterData: true,
      childList: true,
      subtree: true,
    },
  )
  watch([term, current], () => (term.value ? paint() : unpaint()), { flush: 'post' })
  onBeforeUnmount(unpaint)

  /** Whether the list is what the page shows: drawn, with nothing lying over it. */
  function inCharge(): boolean {
    const element = root.value
    if (!element || overlayTop() !== null || popupOpen()) return false
    return typeof element.checkVisibility === 'function'
      ? element.checkVisibility()
      : element.getClientRects().length > 0
  }

  function show() {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && !bar()?.contains(active))
      returnTo = active
    const text = picked()
    if (text) input.value = text
    open.value = true
    void nextTick(focusBar)
    void reveal()
  }

  function close() {
    open.value = false
    const target =
      returnTo?.isConnected === true
        ? returnTo
        : root.value?.querySelector<HTMLElement>('.list-open[tabindex="0"]')
    returnTo = null
    target?.focus({ preventScroll: true })
  }

  function step(by: 1 | -1) {
    const index = stepMatch(matches.value.length, at.value, by)
    if (index < 0) return
    current.value = matches.value[index]
    void reveal()
  }

  function type(text: string) {
    input.value = text
    void reveal()
  }

  useEventListener(globalThis, 'keydown', (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey) return
    const command = event.ctrlKey || event.metaKey
    const find = command && !event.shiftKey && isF(event)
    const again = !command && event.key === 'F3'
    if ((!find && !again) || !inCharge()) return
    event.preventDefault()
    if (find || !open.value) show()
    else step(event.shiftKey ? -1 : 1)
  })

  return {
    /** The current match's order among them all, from 0; -1 with none. */
    at,
    close,
    input,
    open,
    step,
    /** Whether a term is being looked for. */
    searching: computed(() => term.value !== ''),
    total: computed(() => matches.value.length),
    type,
  }
}
