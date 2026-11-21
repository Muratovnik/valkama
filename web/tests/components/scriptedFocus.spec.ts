import { afterEach, expect, it, vi } from 'vitest'

import { walkFocus } from '@/shared/lib/moveFocus.ts'
import { installScriptedFocus } from '@/shared/lib/scriptedFocus.ts'

// The browser's own focus, watched before the wrap goes round it. happy-dom lays nothing out,
// so a frame states its widths, and showing a node does what the browser does to show it:
// centre it, across as well as down. Chromium's centre-if-needed is stubbed beside the
// standard call; a frame built `bare` lacks it, as a browser without it does.
const native = vi.spyOn(HTMLElement.prototype, 'focus')
installScriptedFocus()

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

it('a focus leaves a frame that scrolls across where it stood, and still shows its target', () => {
  const { box, node, shown, centred } = frame(30)
  node.focus()
  expect(document.activeElement).toBe(node)
  // The browser is asked not to scroll; the wrap shows the target as the browser would.
  expect(native.mock.lastCall?.[0]).toMatchObject({ preventScroll: true })
  expect(centred).toHaveBeenCalledExactlyOnceWith(true)
  expect(shown).not.toHaveBeenCalled()
  expect(box.scrollLeft).toBe(30)
})

it('a browser without the centring call shows the target by the nearest edge', () => {
  const { box, node, shown } = frame(30, undefined, true)
  node.focus()
  expect(shown).toHaveBeenCalledExactlyOnceWith(NEAREST)
  expect(box.scrollLeft).toBe(30)
})

it('what the focus handlers scroll themselves stands', () => {
  const { box, node } = frame(0)
  node.addEventListener('focus', () => (box.scrollLeft = 120))
  node.focus()
  expect(box.scrollLeft).toBe(120)
})

it('a focus that scrolls for itself, one already there and one not taken scroll nothing', () => {
  const { box, node, shown, centred } = frame(30)
  node.focus({ preventScroll: true })
  expect(native.mock.lastCall?.[0]).toEqual({ preventScroll: true })
  node.focus()
  expect(shown).not.toHaveBeenCalled()
  expect(centred).not.toHaveBeenCalled()
  expect(box.scrollLeft).toBe(30)
  // A control the reader cannot use takes no focus, and the page is not moved to it.
  const refused = frame(30, Object.assign(document.createElement('button'), { disabled: true }))
  refused.node.focus()
  expect(document.activeElement).not.toBe(refused.node)
  expect(refused.shown).not.toHaveBeenCalled()
  expect(refused.centred).not.toHaveBeenCalled()
})

it('a walk with the arrows goes across, to the nearest edge', () => {
  const { box, node, shown } = frame(0)
  walkFocus(node)
  expect(document.activeElement).toBe(node)
  expect(shown).toHaveBeenCalledExactlyOnceWith(NEAREST)
  expect(box.scrollLeft).toBe(250)
})
