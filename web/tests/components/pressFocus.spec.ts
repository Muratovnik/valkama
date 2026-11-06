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

/** An element of `tag` on the page, with `set` applied to it first. */
function placed<T extends HTMLElement>(tag: string, set: (node: T) => void = () => {}) {
  const node = document.createElement(tag) as T
  set(node)
  return document.body.appendChild(node)
}

// Where typing goes the browser shows focus after a press as well, and a field the interface
// takes the reader to after a click stood unframed until Enter: the browser's verdict stands.
it('after a press, a field typed into keeps the browser verdict on its focus', () => {
  const typed = [
    placed<HTMLInputElement>('input'),
    placed<HTMLInputElement>('input', (node) => (node.type = 'search')),
    placed<HTMLInputElement>('input', (node) => (node.type = 'email')),
    placed<HTMLInputElement>('input', (node) => (node.type = 'number')),
    placed<HTMLTextAreaElement>('textarea'),
    placed<HTMLDivElement>('div', (node) => (node.contentEditable = 'true')),
  ]
  press()
  for (const field of typed) {
    field.focus({ preventScroll: true })
    expect(asked(), field.outerHTML).toEqual({ preventScroll: true })
    moveFocus(field)
    expect(asked(), field.outerHTML).toEqual({})
  }
  // What takes no letters stays quiet after a press, a field that cannot be written in included.
  const quiet = [
    placed<HTMLInputElement>('input', (node) => (node.type = 'checkbox')),
    placed<HTMLInputElement>('input', (node) => (node.readOnly = true)),
    placed<HTMLTextAreaElement>('textarea', (node) => (node.readOnly = true)),
  ]
  for (const field of quiet) {
    field.focus()
    expect(asked(), field.outerHTML).toEqual({ focusVisible: false })
    moveFocus(field)
    expect(asked(), field.outerHTML).toEqual({ focusVisible: false })
  }
})

it('wraps the browser once however often it is installed', () => {
  quietFocusAfterPress()
  press()
  native.mockClear()
  button.focus()
  expect(native).toHaveBeenCalledTimes(1)
  expect(asked()).toEqual({ focusVisible: false })
})
