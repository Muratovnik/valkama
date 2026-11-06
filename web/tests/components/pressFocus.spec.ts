import { expect, it, vi } from 'vitest'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { quietFocusAfterPress } from '@/shared/lib/pressFocus.ts'

// The browser's own focus, watched before the wrap goes round it: what it is asked for is
// what decides the ring, which happy-dom does not draw.
const native = vi.spyOn(HTMLElement.prototype, 'focus')
quietFocusAfterPress()

const button = document.body.appendChild(document.createElement('button'))
const asked = () => native.mock.lastCall?.[0]
const press = () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
const key = (name: string) =>
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))

it('leaves a focus to the browser until the page has had a press', () => {
  button.focus()
  expect(asked()).toBeUndefined()
  // With nothing used yet, a move the interface makes keeps the ring a key would give it.
  moveFocus(button)
  expect(asked()).toEqual({ focusVisible: true })
})

it('after a press, a focus that does not say asks for no ring, and one that says keeps it', () => {
  press()
  button.focus()
  expect(asked()).toEqual({ focusVisible: false })
  button.focus({ preventScroll: true })
  expect(asked()).toEqual({ preventScroll: true, focusVisible: false })
  button.focus({ focusVisible: true })
  expect(asked()).toEqual({ focusVisible: true })
})

// The owner chose no ring after a pointer action: a move the interface makes in answer to a
// press is quiet, and after a key it is ringed, whatever the browser would have guessed.
it('a move the interface makes is ringed after a key and quiet after a press', () => {
  press()
  moveFocus(button, { preventScroll: true })
  expect(asked()).toEqual({ preventScroll: true, focusVisible: false })
  key('Enter')
  moveFocus(button)
  expect(asked()).toEqual({ focusVisible: true })
  // Holding a modifier, or a pointer only passing over the page, leaves the key's word standing.
  key('Control')
  document.body.dispatchEvent(new Event('pointermove', { bubbles: true }))
  moveFocus(button)
  expect(asked()).toEqual({ focusVisible: true })
  press()
  key('Shift')
  moveFocus(button)
  expect(asked()).toEqual({ focusVisible: false })
})

it('a modifier held for a click is not the keyboard; any other key gives the browser back', () => {
  press()
  key('Shift')
  button.focus()
  expect(asked()).toEqual({ focusVisible: false })
  key('ArrowDown')
  button.focus()
  expect(asked()).toBeUndefined()
})

it('wraps the browser once however often it is installed', () => {
  quietFocusAfterPress()
  press()
  native.mockClear()
  button.focus()
  expect(native).toHaveBeenCalledTimes(1)
  expect(asked()).toEqual({ focusVisible: false })
})
