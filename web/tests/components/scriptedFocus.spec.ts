import { afterEach, expect, it, vi } from 'vitest'

import { walkFocus } from '@/shared/lib/moveFocus.ts'
import { placeFocus, showAcross } from '@/shared/lib/scriptedFocus.ts'

// The browser's own focus, watched under the helper. happy-dom lays nothing out, so a frame
// states its widths, and showing a node does what the browser does to show it: centre it,
// across as well as down. Chromium's centre-if-needed is stubbed beside the standard call; a
// frame built `bare` lacks it, as a browser without it does.
const native = vi.spyOn(HTMLElement.prototype, 'focus')

afterEach(() => {
  document.body.replaceChildren()
  native.mockClear()
})

type Centred = HTMLElement & { scrollIntoViewIfNeeded?: (centre?: boolean) => void }

/** A frame 100px wide over 400px of content, standing `left` across, holding `node`. */
function frame(left: number, node: Centred = document.createElement('button'), bare = false) {
  const box = document.body.appendChild(document.createElement('div'))
  Object.defineProperty(box, 'scrollWidth', { value: 400 })
  Object.defineProperty(box, 'clientWidth', { value: 100 })
  box.scrollLeft = left
  box.append(node)
  const slide = () => {
    box.scrollLeft = 250
  }
  const shown = vi.fn(slide)
  const centred = vi.fn(slide)
  node.scrollIntoView = shown
  if (!bare) node.scrollIntoViewIfNeeded = centred
  return { box, node, shown, centred }
}

const NEAREST = { block: 'nearest', inline: 'nearest' }

it('a placed focus in sight leaves a frame that scrolls across where it stood, and still shows its target', () => {
  const { box, node, shown, centred } = frame(30)
  placeFocus(node, { focusVisible: true })
  expect(document.activeElement).toBe(node)
  // The browser is asked not to scroll; the helper shows the target as the browser would.
  expect(native).toHaveBeenCalledExactlyOnceWith({ focusVisible: true, preventScroll: true })
  expect(centred).toHaveBeenCalledExactlyOnceWith(true)
  expect(shown).not.toHaveBeenCalled()
  expect(box.scrollLeft).toBe(30)
})

it('a browser without the centring call shows the target by the nearest edge', () => {
  const { box, node, shown } = frame(30, undefined, true)
  placeFocus(node)
  expect(shown).toHaveBeenCalledExactlyOnceWith(NEAREST)
  expect(box.scrollLeft).toBe(30)
})

it('what the focus handlers scroll themselves stands', () => {
  const { box, node } = frame(0)
  node.addEventListener('focus', () => (box.scrollLeft = 120))
  placeFocus(node)
  expect(box.scrollLeft).toBe(120)
})

it('a focus that scrolls for itself, one already there, one not taken and none scroll nothing', () => {
  const { box, node, shown, centred } = frame(30)
  placeFocus(node, { preventScroll: true })
  expect(native).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
  placeFocus(node)
  expect(shown).not.toHaveBeenCalled()
  expect(centred).not.toHaveBeenCalled()
  expect(box.scrollLeft).toBe(30)
  // A control the reader cannot use takes no focus, and the page is not moved to it.
  const refused = frame(30, Object.assign(document.createElement('button'), { disabled: true }))
  placeFocus(refused.node)
  expect(document.activeElement).not.toBe(refused.node)
  expect(refused.shown).not.toHaveBeenCalled()
  expect(refused.centred).not.toHaveBeenCalled()
  native.mockClear()
  placeFocus(null)
  expect(native).not.toHaveBeenCalled()
})

it('a walk with the arrows goes across, to the nearest edge', () => {
  const { box, node, shown } = frame(0)
  walkFocus(node)
  expect(document.activeElement).toBe(node)
  expect(shown).toHaveBeenCalledExactlyOnceWith(NEAREST)
  expect(box.scrollLeft).toBe(250)
})

/** Lays `node` out at `left`..`right` of the content, read through where `box` stands across. */
function laidOut(box: HTMLElement, node: Element, left: number, right: number) {
  box.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, width: 100 })
  node.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: left - box.scrollLeft, width: right - left })
}

it('a placed focus past the end of a frame the reader scrolls brings it in by that edge', () => {
  const { box, node } = frame(0)
  box.style.overflowX = 'auto'
  laidOut(box, node, 150, 180)
  placeFocus(node)
  // Not held at 0, where the target stays out of sight, nor centred at 250: its end at the frame's.
  expect(box.scrollLeft).toBe(80)
})

it('a target in sight moves nothing, and a box that only clips is held', () => {
  const shown = frame(0)
  shown.box.style.overflowX = 'auto'
  laidOut(shown.box, shown.node, 20, 50)
  placeFocus(shown.node)
  expect(shown.box.scrollLeft).toBe(0)
  const clipped = frame(0)
  clipped.box.style.overflowX = 'hidden'
  laidOut(clipped.box, clipped.node, 150, 180)
  placeFocus(clipped.node)
  expect(clipped.box.scrollLeft).toBe(0)
})

it('a region before the start of its frame comes in by the start, clear by the reach asked', () => {
  const { box, node } = frame(200)
  box.style.overflowX = 'auto'
  laidOut(box, node, 170, 190)
  showAcross(node, 4)
  expect(box.scrollLeft).toBe(166)
  // A region wider than its frame past its end shows its start; one that covers it moves nothing.
  const wide = frame(0)
  wide.box.style.overflowX = 'scroll'
  laidOut(wide.box, wide.node, 120, 300)
  showAcross(wide.node)
  expect(wide.box.scrollLeft).toBe(120)
  const covering = frame(150)
  covering.box.style.overflowX = 'auto'
  laidOut(covering.box, covering.node, 100, 300)
  showAcross(covering.node)
  expect(covering.box.scrollLeft).toBe(150)
})
