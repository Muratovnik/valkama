import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { frames } from './frames.ts'

/*
 * The row of controls at the foot of a question or of a list under a comment
 * (`RequestActions`), read off the built page: what is drawn on each of its lines, where the two
 * answers stand, and what the step of declining does to it. Every consumer of the row is held to
 * the same rules, so they live here once.
 */

/** The gap a row keeps between its controls. */
const GAP = 8

/** How wide the place before the answers stays where the asking can come, in rems: the same in
 *  every language, since its words do not set it. */
const ASKING_ROOM_REM = 12

type Edge = { bottom: number; left: number; right: number; top: number }

/**
 * Each control of the row as drawn: the comment's glyph by its `path`, the others by their box,
 * whether it stands before the two answers, and whether in the place before them. Only what can
 * be seen counts. `apart` says the row is as narrow as a phone's, where that place is the line
 * above the buttons (DESIGN.md).
 */
const membersOf = (row: Locator) =>
  row.evaluate((node) => {
    const members = [...node.querySelectorAll<HTMLElement>('button')]
      .filter((button) => getComputedStyle(button).visibility === 'visible')
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => {
        const path = button.querySelector('svg path')
        const { bottom, left, right, top } = (path ?? button).getBoundingClientRect()
        const whole = button.getBoundingClientRect()
        return {
          bottom,
          left,
          right,
          top,
          lead: button.closest('.request-pair') === null,
          placed: button.closest('.request-lead') !== null,
          slotted: button.closest('.request-lead, .request-pair') === null,
          name: (button.getAttribute('aria-label') ?? button.textContent ?? '').trim(),
          box: { bottom: whole.bottom, left: whole.left, right: whole.right, top: whole.top },
        }
      })
    const { bottom, left, right, top } = node.getBoundingClientRect()
    // The place kept for the asking where no control stands in it, and one line of its words.
    const lead = node.querySelector('.request-lead')
    const held = lead && !lead.querySelector('button') ? lead.getBoundingClientRect() : null
    const room = held && { bottom: held.bottom, left: held.left, right: held.right, top: held.top }
    const line = lead ? Number.parseFloat(getComputedStyle(lead, '::before').lineHeight) : 0
    const apart = lead !== null && getComputedStyle(lead).order === '-1'
    // A rem, for the room the place keeps where the asking can come into it.
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    const asks = lead instanceof HTMLElement && lead.dataset.room !== undefined
    // The controls offered in the place, seen or hidden while the asking stands over them.
    const offered = [...(lead?.querySelectorAll('button') ?? [])]
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => button.getBoundingClientRect().width)
    const row = { bottom, left, right, top }
    return { apart, asks, rem, row, members, offered, room, line }
  })
type Row = Awaited<ReturnType<typeof membersOf>>

/** How wide the asking's words are on one line, in the type they are drawn in. */
const askingWidth = (row: Locator) =>
  row.evaluate((node) => {
    const lead = node.querySelector<HTMLElement>('.request-lead')
    const words = lead?.dataset.room
    if (!lead || !words) return 0
    const probe = document.createElement('span')
    probe.textContent = words
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'
    probe.style.font = getComputedStyle(lead, '::before').font
    document.body.append(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  })

/** The lines the asking's words are drawn on, read off the text itself. */
const askingLines = (row: Locator) =>
  row.locator('.request-asked').evaluate((node) => {
    const text = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode()
    if (!text) throw new Error('The asking has no words')
    const range = document.createRange()
    range.selectNodeContents(text)
    return [...range.getClientRects()].map(({ bottom, left, right, top }) => ({
      bottom,
      left,
      right,
      top,
    }))
  })

export const centre = (edge: Edge) => (edge.top + edge.bottom) / 2
export const near = (one: number, other: number) => Math.abs(one - other) <= 1
const overlaps = (one: Edge, other: Edge) =>
  one.left < other.right &&
  other.left < one.right &&
  one.top < other.bottom &&
  other.top < one.bottom

/**
 * Every line of the row holds a control seen: its bottom is theirs, and no gap between two lines
 * is wider than the row's gap. The place kept unseen for the asking is no control. Its band over
 * the row is the one exception, where it stands with no control in it: exactly one line of its
 * words and the row's gap, nothing more. A row that declines nothing keeps no such place.
 */
function expectNoEmptyBand({ line, members, room, row }: Row, what: string, declinable: boolean) {
  if (!declinable) expect(room, `${what}: no place kept for an asking`).toBeNull()
  const spans = members
    .map((member) => [member.box.top, member.box.bottom] as const)
    .sort((a, b) => a[0] - b[0])
  const top = (spans[0]?.[0] ?? row.top) - row.top
  if (room && top > 1) {
    expect(near(room.top, row.top), `${what}: the band is the place kept for the asking`).toBe(true)
    expect(
      Math.abs(top - (line + GAP)),
      `${what}: the band is one line of the asking and the gap, ${top.toFixed(1)}px`,
    ).toBeLessThanOrEqual(1)
  } else expect(top, `${what}: the row starts with a control`).toBeLessThanOrEqual(1)
  let reached = spans[0]?.[1] ?? row.top
  for (const [start, end] of spans) {
    expect(start - reached, `${what}: no empty band between lines`).toBeLessThanOrEqual(GAP + 1)
    reached = Math.max(reached, end)
  }
  expect(near(row.bottom, reached), `${what}: the row ends with a control`).toBe(true)
}

/** The two answers on one line at the row's end, and what comes before them at its start, in
 *  order, one gap apart, so that none of it changes sides with the width. */
function expectSides({ members, row }: Row, what: string) {
  const pair = members.filter((member) => !member.lead)
  const lead = members.filter((member) => member.lead)
  const [wayOut, onward] = pair
  if (wayOut && onward) {
    expect(near(wayOut.top, onward.top), `${what}: the pair shares a line`).toBe(true)
    expect(near(onward.right, row.right), `${what}: the pair ends the row`).toBe(true)
  }
  const [first, ...rest] = lead.map((member) => member.box)
  if (!first) return
  expect(first.left - row.left, `${what}: the first control starts the row`).toBeLessThanOrEqual(
    GAP,
  )
  let before = first
  for (const box of rest) {
    const sameLine = near(centre(before), centre(box))
    // The comment's glyph is moved onto the axis of the radios, so the gap after it is not
    // quite the row's; what follows still stands right after it, not across the line.
    if (sameLine)
      expect(box.left - before.right, `${what}: right after`).toBeLessThanOrEqual(2 * GAP)
    else
      expect(box.left - row.left, `${what}: a new line starts at the row's start`).toBeLessThan(GAP)
    before = box
  }
}

/**
 * One line wherever it fits: the controls before the pair, the pair, and the asking on two
 * lines in the place those controls leave beside the pair.
 */
function fitsOneLine({ members, row }: Row, asking: number) {
  const boxes = members.map((member) => member.box)
  const widths = boxes.map((box) => box.right - box.left)
  const pair = boxes.filter((_, index) => !members[index]?.lead)
  const pairWidth = pair.reduce((sum, box) => sum + box.right - box.left, 0) + GAP
  const place = row.right - row.left - pairWidth - GAP
  const controls = widths.reduce((sum, width) => sum + width, 0) + GAP * (widths.length - 1)
  return controls <= row.right - row.left && (asking === 0 || asking <= 2 * place - 3 * GAP)
}

function expectOnOneLine(members: Row['members'], what: string) {
  const [first, ...rest] = members.map((member) => centre(member.box))
  for (const other of rest) expect(near(other, first ?? other), what).toBe(true)
}

const pairOf = (measured: Row) => measured.members.filter((member) => !member.lead)

/** How wide these controls are side by side. */
const across = (members: Row['members']) =>
  members.reduce((sum, { box }) => sum + box.right - box.left, GAP * (members.length - 1))

/** Whether these controls fit side by side across the row. */
const fitAcross = (members: Row['members'], { row }: Row) => across(members) <= row.right - row.left

/**
 * Whether the comment's glyph leads the place's line on a phone's row: where it, the gap and the
 * place fit the row, the place as wide as the controls offered there, seen or under the asking,
 * or as the room it keeps where the asking can come, whichever is wider. A pixel either side is
 * the browser's rounding.
 */
function glyphLeads(measured: Row, slotted: Row['members']) {
  const room = measured.asks ? ASKING_ROOM_REM * measured.rem : 0
  const { offered } = measured
  const controls = offered.reduce((sum, width) => sum + width, GAP * (offered.length - 1))
  const needs = across(slotted) + GAP + Math.max(controls, room)
  const width = measured.row.right - measured.row.left
  return Math.abs(needs - width) <= 1 ? undefined : needs < width
}

/** Where the place holds no control or the glyph does not lead it: the glyph is on the buttons'
 *  line, those are one line where they fit across, and the pair is one line wherever. */
function expectGlyphBelow(measured: Row, placed: Row['members'], what: string) {
  const rest = measured.members.filter((member) => !placed.includes(member))
  if (fitAcross(rest, measured)) expectOnOneLine(rest, `${what}: the buttons are one line`)
  else expectOnOneLine(pairOf(measured), `${what}: the pair is one line`)
  if (placed.length === 0) return
  const above = Math.max(...placed.map(({ box }) => box.bottom))
  for (const member of rest)
    expect(member.box.top, `${what}: ${member.name} under the place`).toBeGreaterThanOrEqual(
      above - 1,
    )
}

function expectOneLineWhereItFits(measured: Row, asking: number, what: string) {
  if (!measured.apart) {
    if (fitsOneLine(measured, asking))
      expectOnOneLine(measured.members, `${what}: one line, as everything fits`)
    return
  }
  // As narrow as a phone's, the place before the buttons is the line above theirs. The comment's
  // glyph leads the place's line where it and the place's controls fit that line, and keeps the
  // buttons' line otherwise, or where the place holds only the asking's room: taken up anyway,
  // it was left a line alone over a place broken onto a line of its own.
  const inPlace = measured.members.filter((member) => member.placed)
  const slotted = measured.members.filter((member) => member.slotted)
  const leads = measured.offered.length > 0 && slotted.length > 0 && glyphLeads(measured, slotted)
  if (leads === undefined) {
    expectOnOneLine(pairOf(measured), `${what}: the pair is one line`)
    return
  }
  if (!leads) {
    expectGlyphBelow(measured, inPlace, what)
    return
  }
  // A place of controls is no line apart where all of it fits on one with the buttons.
  if (inPlace.length > 0 && fitsOneLine(measured, asking)) {
    expectOnOneLine(measured.members, `${what}: one line, as everything fits`)
    return
  }
  const placed = [...slotted, ...inPlace]
  expectOnOneLine(placed, `${what}: the glyph leads the place, on one line`)
  expectGlyphBelow(measured, placed, what)
}

/**
 * The rules of the row, every one: no empty band, the pair at the end and what comes before it
 * at the start, one line where it all fits. A row that declines nothing (`declinable` false, a
 * list under a comment) also keeps no place for the asking.
 */
export async function expectRow(row: Locator, what: string, { declinable = true } = {}) {
  const measured = await membersOf(row)
  expect(measured.members.length, `${what}: has controls`).toBeGreaterThan(0)
  expectNoEmptyBand(measured, what, declinable)
  // Nor inside its buttons: one keeps room only for a word it can show, and a row that declines
  // nothing has no "Don't answer" to show.
  if (!declinable)
    for (const { name, room } of await heldRoom(row))
      expect(room, `${what}: ${name} as wide as its words`).toBeLessThanOrEqual(1)
  expectSides(measured, what)
  expectOneLineWhereItFits(measured, await askingWidth(row), what)
  return measured
}

/**
 * How much wider each button that holds room for its other word (`request-held`) is than its
 * own words and its padding: the room it keeps for a word it may show instead.
 */
const heldRoom = (row: Locator) =>
  row.evaluate((node) =>
    [...node.querySelectorAll<HTMLElement>('.request-held')]
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => {
        const text = document
          .createTreeWalker(button, NodeFilter.SHOW_TEXT, {
            acceptNode: (found) =>
              found.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
          })
          .nextNode()
        const range = document.createRange()
        if (text) range.selectNodeContents(text)
        const words = text ? range.getBoundingClientRect().width : 0
        const style = getComputedStyle(button)
        const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight)
        const name = (button.textContent ?? '').trim()
        return { name, room: button.getBoundingClientRect().width - words - padding }
      }),
  )

const nextFrames = (scope: Locator) => frames(scope)

/** The step of declining, raised by the press: nothing moves, and its words stand where the
 *  controls before the pair stood, on one line where that place allows. */
export async function expectStep(card: Locator, what: string) {
  const row = card.locator('.request-actions')
  // In view as a person brings it, so that the press scrolls nothing.
  await row.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'nearest' }))
  const before = await membersOf(row)
  const asking = await askingWidth(row)
  await card.locator('.request-way-out').click()
  await expect(card.getByRole('alert')).toBeInViewport({ ratio: 1 })
  // Under reduced motion every change is a transition of a hundredth of a millisecond, which
  // still ends only on the next frame.
  await nextFrames(card)
  const during = await membersOf(row)
  expect(during.row, `${what}: the row stays`).toEqual(before.row)
  expect(
    pairOf(during).map(({ left, top }) => ({ left, top })),
    `${what}: the pair stays`,
  ).toEqual(pairOf(before).map(({ left, top }) => ({ left, top })))
  const lines = await askingLines(row)
  // A place kept for the asking alone is exactly as tall as what it draws there, one line.
  if (before.room) {
    const drawn =
      Math.max(...lines.map((line) => line.bottom)) - Math.min(...lines.map((line) => line.top))
    expect(
      Math.abs(drawn - (before.room.bottom - before.room.top)),
      `${what}: the place is the words'`,
    ).toBeLessThanOrEqual(2)
    // On a line of its own, over the buttons, that place is the row's one empty band.
    const room = before.room
    if (pairOf(before).every((member) => member.box.top >= room.bottom))
      expect(lines, `${what}: the asking on one line over the buttons`).toHaveLength(1)
  }
  const pairLeft = Math.min(...pairOf(during).map((member) => member.left))
  for (const line of lines) {
    expect(
      line.top >= during.row.top - 1 && line.bottom <= during.row.bottom + 1,
      `${what}: in the row`,
    ).toBe(true)
    for (const member of during.members)
      expect(overlaps(line, member), `${what}: on nothing (${member.name})`).toBe(false)
  }
  const sameLineAsPair = lines.every((line) => line.right <= pairLeft)
  // Over the buttons the place is its line, less the comment's glyph where that leads it.
  const over = await row
    .locator('.request-lead')
    .evaluate((lead) => lead.getBoundingClientRect().width)
  const place = sameLineAsPair ? pairLeft - GAP - during.row.left : over
  if (asking <= place) expect(lines, `${what}: one line where it fits`).toHaveLength(1)
  else expect(lines.length, `${what}: two lines at most`).toBeLessThanOrEqual(2)
  await card.locator('.request-way-out').click()
  await expect(card.getByRole('alert')).toHaveCount(0)
}
