/**
 * The label room of one line of marks, worked out from the line's width and
 * the chips' text, with nothing drawn to be measured.
 *
 * Each line used to draw its candidate chips a second time out of sight, read
 * their boxes and watch its own width with an observer of its own. Every
 * observer is its own callback, and Vue redraws between two callbacks, so a
 * board of a hundred tiles laid itself out a hundred times on its way to a
 * still frame: the line redrawn after one tile's reading was laid out again
 * for the next tile's. The copies were some 800 of the board's 6,000 nodes
 * besides.
 *
 * Now one observer watches every line on the page, so a frame hands it every
 * changed width at once and nothing is read from a box between two writes:
 * the widths come with the observer's entries, and a chip's width is its text
 * measured in the chip's font plus the chip's own padding, read once for the
 * page. The room is derived from those, so a line redraws at most once per
 * change, and a chip label that changes needs no new reading.
 *
 * Showing fewer chips does not change the line's width — it is as wide as what
 * holds it — so a room never feeds back into the next one.
 */
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { chipsThatFit } from '@/entities/work-item/utils/labelRoom.ts'

/** What every line measures with, read from the first drawn chip and kept for the page. */
interface ChipMetrics {
  /** The chip's padding and borders, face included, in px. */
  chrome: number
  /** The canvas font the chip's words are drawn in. */
  font: string
  /** The gap between two marks on the line, in px. */
  gap: number
}

const metrics = shallowRef<ChipMetrics | null>(null)
const textWidths = new Map<string, number>()
let context: CanvasRenderingContext2D | null | undefined

function measuringContext() {
  if (context === undefined) context = document.createElement('canvas').getContext('2d')
  return context
}

/**
 * Layout places a box on a grid of 1/64 px and rounds a run of text up to it,
 * so the canvas's exact advance is a hair narrower than the box the words
 * get; rounded the same way, a chip counted as fitting is never cut.
 */
const LAYOUT_UNIT = 64

/** The drawn width of some words in the chips' font, cached for the page. */
function textWidth(text: string, font: string): number {
  const known = textWidths.get(text)
  if (known !== undefined) return known
  const canvas = measuringContext()
  if (!canvas) return 0
  canvas.font = font
  const width = Math.ceil(canvas.measureText(text).width * LAYOUT_UNIT) / LAYOUT_UNIT
  textWidths.set(text, width)
  return width
}

const inlineChrome = (element: Element) => {
  const style = getComputedStyle(element)
  return [
    style.paddingInlineStart,
    style.paddingInlineEnd,
    style.borderInlineStartWidth,
    style.borderInlineEndWidth,
  ].reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0)
}

/** What a chip of this line is drawn with: its font, its padding and the line's gap. */
function readMetrics(line: Element, chip: Element): ChipMetrics {
  const style = getComputedStyle(chip)
  const chrome = [chip, ...chip.children].reduce((sum, part) => sum + inlineChrome(part), 0)
  return {
    chrome,
    font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    gap: Number.parseFloat(getComputedStyle(line).columnGap) || 0,
  }
}

const CHIP = '.label-chip'
const lines = new Map<Element, (width: number) => void>()
let observer: ResizeObserver | undefined

/**
 * Every changed line in one callback: the widths come from the entries, and
 * the first line that holds a chip says what chips are drawn with, while the
 * layout the observer was called after is still the current one.
 */
function observed(entries: readonly ResizeObserverEntry[]) {
  if (!metrics.value) {
    const sample = entries.find((entry) => entry.target.querySelector(CHIP))
    const chip = sample?.target.querySelector(CHIP)
    if (sample && chip) metrics.value = readMetrics(sample.target, chip)
  }
  for (const entry of entries) {
    const box = entry.contentBoxSize[0]
    lines.get(entry.target)?.(box ? box.inlineSize : entry.contentRect.width)
  }
}

function observe(line: Element, report: (width: number) => void) {
  // Where nothing lays the page out, nothing is measured and the limit holds.
  if (typeof ResizeObserver === 'undefined') return
  observer ??= new ResizeObserver(observed)
  lines.set(line, report)
  observer.observe(line)
}

function unobserve(line: Element) {
  lines.delete(line)
  observer?.unobserve(line)
}

/** Words measured before the product's fonts arrived were measured in a fallback. */
function remeasure() {
  textWidths.clear()
  metrics.value = metrics.value && { ...metrics.value }
}
if (typeof document !== 'undefined') document.fonts?.addEventListener('loadingdone', remeasure)

/** What a host knows of the run it fits on one line. */
export interface LabelLine {
  /** The chips that might print, in order, as the registry would print them with no line. */
  candidates: () => readonly string[]
  /** The line fits its chips at all; otherwise it is not observed. */
  enabled: () => boolean
  /** The widest «+N» the line could print, in the words it would print. */
  more: () => string | undefined
  /** How many labels the item has, candidates or not. */
  total: () => number
}

/**
 * The room, or undefined until the line has been measured — which leaves the
 * registry's own limit in force, as a host that does not measure gets it.
 */
export function useLabelRoom(
  line: Ref<HTMLElement | null>,
  run: LabelLine,
): ComputedRef<number | undefined> {
  const width = shallowRef<number | undefined>()
  const report = (value: number) => {
    width.value = value
  }

  watch(
    [line, run.enabled],
    ([element, enabled], _, onCleanup) => {
      width.value = undefined
      if (!element || !enabled) return
      observe(element, report)
      onCleanup(() => unobserve(element))
    },
    { immediate: true, flush: 'post' },
  )
  onScopeDispose(() => {
    if (line.value) unobserve(line.value)
  })

  function fit(drawn: ChipMetrics, room: number) {
    const more = run.more()
    return chipsThatFit({
      chips: run.candidates().map((label) => textWidth(label, drawn.font) + drawn.chrome),
      gap: drawn.gap,
      more: more === undefined ? 0 : textWidth(more, drawn.font),
      line: room,
      total: run.total(),
    })
  }

  return computed(() => {
    const drawn = metrics.value
    const room = width.value
    return run.enabled() && room !== undefined && drawn ? fit(drawn, room) : undefined
  })
}
