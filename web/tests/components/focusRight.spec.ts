import { beforeEach, expect, it } from 'vitest'

import { grantFocus, latestFocusRight, NO_FOCUS_RIGHT } from '@/shared/lib/focusRight.ts'

// A field the person types in, and the place an action would land.
const field = document.body.appendChild(document.createElement('textarea'))
const landing = document.body.appendChild(document.createElement('button'))
const other = document.body.appendChild(document.createElement('button'))

/** A press or a key reaches the page, then its own focus follows, as the browser orders them. */
const press = (focused?: HTMLElement) => {
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  focused?.focus()
}
const key = (name: string, focused?: HTMLElement) => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }))
  focused?.focus()
}
const land = (right: ReturnType<typeof grantFocus>) => right.take(() => landing.focus())

beforeEach(() => {
  ;(document.activeElement as HTMLElement | null)?.blur()
  other.focus()
})

it('a right given lands where nothing has moved since', () => {
  const right = grantFocus()
  land(right)
  expect(document.activeElement).toBe(landing)
})

it('the press that began the action is behind it, focus it gave included', () => {
  press(other)
  const right = grantFocus()
  land(right)
  expect(document.activeElement).toBe(landing)
})

it('a press into a field after the right was given keeps focus in the field', () => {
  const right = grantFocus()
  press(field)
  land(right)
  expect(document.activeElement).toBe(field)
})

it('a key that moved focus after the right was given keeps it where it went', () => {
  const right = grantFocus()
  key('Tab', field)
  land(right)
  expect(document.activeElement).toBe(field)
  // Once gone the right stays gone, even with the person back where they began.
  key('Tab', other)
  land(right)
  expect(document.activeElement).toBe(other)
})

it('a press or a key that moves nothing leaves the right standing', () => {
  const right = grantFocus()
  press()
  key('ArrowDown')
  land(right)
  expect(document.activeElement).toBe(landing)
})

it("the interface's own moves are not the person's", () => {
  const right = grantFocus()
  // With no input since, a script's focus is the interface's: a form closing, a drawer opening.
  field.focus()
  // A move the right made itself, after a key: the right outlasts it, for the next one.
  key('ArrowDown')
  right.take(() => other.focus())
  land(right)
  expect(document.activeElement).toBe(landing)
})

it('focus fallen to the page, by a removal or a press on nothing, takes it from nobody', () => {
  const right = grantFocus()
  const gone = document.body.appendChild(document.createElement('button'))
  press(gone)
  gone.remove()
  other.blur()
  land(right)
  expect(document.activeElement).toBe(landing)
  // Without a right a move only fills a focus nothing holds.
  other.focus()
  land(NO_FOCUS_RIGHT)
  expect(document.activeElement).toBe(other)
  other.blur()
  land(NO_FOCUS_RIGHT)
  expect(document.activeElement).toBe(landing)
})

it('each action has its own right: the press that begins one leaves the one before', () => {
  const first = grantFocus()
  press(field)
  const second = grantFocus()
  land(first)
  expect(document.activeElement).toBe(field)
  land(second)
  expect(document.activeElement).toBe(landing)
})

it("an owner's latest right replaces the one before, and is spent when it lands", () => {
  const owner = latestFocusRight()
  owner.take(() => landing.focus())
  expect(document.activeElement).toBe(other)
  owner.give()
  owner.take(() => landing.focus())
  expect(document.activeElement).toBe(landing)
  owner.spend()
  other.focus()
  owner.take(() => field.focus())
  expect(document.activeElement).toBe(other)
})

it('forgetting input counts the right from then on', () => {
  const owner = latestFocusRight()
  owner.give()
  press()
  owner.forgetInput()
  // A move that follows no input since is nobody's.
  field.focus()
  owner.take(() => landing.focus())
  expect(document.activeElement).toBe(landing)
})
