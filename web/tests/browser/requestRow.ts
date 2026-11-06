import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/*
 * The row of controls at the foot of a question or of a list under a comment
 * (`RequestActions`), read off the built page: what is drawn on each of its lines, where the two
 * answers stand, and what the step of declining does to it. Every consumer of the row is held to
 * the same rules, so they live here once.
 */

/** The gap a row keeps between its controls. */
const GAP = 8

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
    return { apart, row: { bottom, left, right, top }, members, room, line }
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

/** Whether these controls fit side by side across the row. */
function fitAcross(members: Row['members'], { row }: Row) {
  const widths = members.map(({ box }) => box.right - box.left)
  return (
    widths.reduce((sum, width) => sum + width, GAP * (widths.length - 1)) <= row.right - row.left
  )
}

function expectOneLineWhereItFits(measured: Row, asking: number, what: string) {
  if (!measured.apart) {
    if (fitsOneLine(measured, asking))
      expectOnOneLine(measured.members, `${what}: one line, as everything fits`)
    return
  }
  // As narrow as a phone's, the place before the buttons is the line above theirs: each of the
  // two is one line where its controls fit, the comment's glyph on the buttons' line.
  const placed = measured.members.filter((member) => member.placed)
  const rest = measured.members.filter((member) => !member.placed)
  if (fitAcross(placed, measured)) expectOnOneLine(placed, `${what}: the place is one line`)
  if (fitAcross(rest, measured)) expectOnOneLine(rest, `${what}: the buttons are one line`)
  const above = Math.max(...placed.map(({ box }) => box.bottom))
  for (const member of rest)
    expect(member.box.top, `${what}: the buttons under the place`).toBeGreaterThanOrEqual(above)
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
  expectSides(measured, what)
  expectOneLineWhereItFits(measured, await askingWidth(row), what)
  return measured
}

const pairOf = (measured: Row) => measured.members.filter((member) => !member.lead)

const nextFrames = (scope: Locator) =>
  scope.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  )

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
  const place = sameLineAsPair
    ? pairLeft - GAP - during.row.left
    : during.row.right - during.row.left
  if (asking <= place) expect(lines, `${what}: one line where it fits`).toHaveLength(1)
  else expect(lines.length, `${what}: two lines at most`).toBeLessThanOrEqual(2)
  await card.locator('.request-way-out').click()
  await expect(card.getByRole('alert')).toHaveCount(0)
}
