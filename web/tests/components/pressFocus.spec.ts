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
})

it('after a press, a focus that does not say asks for no ring, and one that says keeps it', () => {
  press()
  button.focus()
  expect(asked()).toEqual({ focusVisible: false })
  button.focus({ preventScroll: true })
  expect(asked()).toEqual({ preventScroll: true, focusVisible: false })
  moveFocus(button)
  expect(asked()).toEqual({ focusVisible: true })
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
