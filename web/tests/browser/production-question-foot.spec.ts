/**
 * The row of controls at the foot of a question, read off the built page in every state it has,
 * in both languages, at a laptop's width and a phone's: waiting, after a send that failed, after
 * the deadline, in the list of everything waiting, and while an answer is changed.
 *
 * Every line of the row holds a control, but for the one place the step of declining needs
 * where nothing else can give it, and that is exactly as tall as its words: the comment's glyph
 * never takes a line of its own (DESIGN.md), and on a phone in the card nothing else stands
 * before the buttons. The two answers are one pair at the row's end; what comes before them
 * keeps the row's start at every width; the row is one line wherever its controls and the
 * asking fit on one; and the step moves nothing, its words drawn where the way to the task and
 * Check status stood, on one line where that place allows.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { expectStripOnColumn } from './confirmStrip.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

const LOCALES = ['en', 'ru'] as const
const WIDTHS = [1280, 390] as const
type Locale = (typeof LOCALES)[number]

const LATE = '44444444-4444-4444-8444-444444444449'
const LIST_TITLE = /^(?:Needs my answer|Ждут моего ответа)/u
/** The gap a row keeps between its controls. */
const GAP = 8

type Edge = { bottom: number; left: number; right: number; top: number }

/**
 * Each control of the row as drawn: the comment's glyph by its `path`, the others by their box,
 * and whether it stands before the two answers. Only what can be seen counts.
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
          name: (button.getAttribute('aria-label') ?? button.textContent ?? '').trim(),
          box: { bottom: whole.bottom, left: whole.left, right: whole.right, top: whole.top },
        }
      })
    const { bottom, left, right, top } = node.getBoundingClientRect()
    // The place kept for the asking where no control stands in it.
    const lead = node.querySelector('.request-lead')
    const held = lead && !lead.querySelector('button') ? lead.getBoundingClientRect() : null
    const room = held && { bottom: held.bottom, left: held.left, right: held.right, top: held.top }
    return { row: { bottom, left, right, top }, members, room }
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

const centre = (edge: Edge) => (edge.top + edge.bottom) / 2
const near = (one: number, other: number) => Math.abs(one - other) <= 1
const overlaps = (one: Edge, other: Edge) =>
  one.left < other.right &&
  other.left < one.right &&
  one.top < other.bottom &&
  other.top < one.bottom

/** Every line of the row holds a control: its top and bottom are theirs, and no gap between
 *  two lines is wider than the row's gap. */
function expectNoEmptyBand({ members, room, row }: Row, what: string) {
  const boxes = [...members.map((member) => member.box), ...(room ? [room] : [])]
  const tops = Math.min(...boxes.map((box) => box.top))
  const bottoms = Math.max(...boxes.map((box) => box.bottom))
  expect(near(row.top, tops), `${what}: the row starts with a control`).toBe(true)
  expect(near(row.bottom, bottoms), `${what}: the row ends with a control`).toBe(true)
  const spans = boxes.map((box) => [box.top, box.bottom] as const).sort((a, b) => a[0] - b[0])
  let reached = spans[0]?.[1] ?? row.top
  for (const [top, bottom] of spans) {
    expect(top - reached, `${what}: no empty band between lines`).toBeLessThanOrEqual(GAP + 1)
    reached = Math.max(reached, bottom)
  }
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

function expectOneLineWhereItFits(measured: Row, asking: number, what: string) {
  if (!fitsOneLine(measured, asking)) return
  const [first, ...rest] = measured.members.map((member) => centre(member.box))
  for (const other of rest)
    expect(near(other, first ?? other), `${what}: one line, as everything fits`).toBe(true)
}

async function expectRow(row: Locator, what: string) {
  const measured = await membersOf(row)
  expect(measured.members.length, `${what}: has controls`).toBeGreaterThan(0)
  expectNoEmptyBand(measured, what)
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
async function expectStep(card: Locator, what: string) {
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
  // A place kept for the asking alone is exactly as tall as what it draws there.
  if (before.room) {
    const drawn =
      Math.max(...lines.map((line) => line.bottom)) - Math.min(...lines.map((line) => line.top))
    expect(
      Math.abs(drawn - (before.room.bottom - before.room.top)),
      `${what}: the place is the words'`,
    ).toBeLessThanOrEqual(2)
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

async function inLocale(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

const waitingAndLate = () => [
  asked({ created_at: '2026-10-24T11:00:00Z' }),
  asked({
    request_id: LATE,
    prompt: 'A question past its deadline',
    expires_at: '2020-01-01T10:00:00Z',
    created_at: '2026-10-24T09:00:00Z',
  }),
]

/** Chooses and sends, and the send fails: the row gains Check status. */
async function failSend(card: Locator, requests: { failNext: (status: number) => unknown }) {
  await card.getByRole('radio').first().check()
  requests.failNext(503)
  await card.locator('.request-onward').click()
  await expect(card.locator('.request-error')).toBeVisible()
}

const answered = asked({
  status: 'answered',
  answers: { route: 'move' },
  own: {},
  field_notes: {},
  answered_by: 'user',
  by_person: true,
  resolved_at: '2026-10-24T12:00:00Z',
  revision: 2,
  answer_version: 1,
})

for (const locale of LOCALES)
  for (const width of WIDTHS) {
    const at = `${locale} at ${width}`

    test(`${at}: the row of a question in its card, waiting, past its deadline and after a failed send`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const { card, requests } = await openQuestion(page, waitingAndLate())
      const waiting = card.first()
      await expect(waiting.locator('.request-actions')).toBeVisible()
      await expectRow(waiting.locator('.request-actions'), `${at} waiting`)
      await expectStep(waiting, `${at} waiting`)
      await expectRow(card.nth(1).locator('.request-actions'), `${at} past its deadline`)
      await failSend(waiting, requests)
      await expectRow(waiting.locator('.request-actions'), `${at} after a failed send`)
    })

    test(`${at}: the row of a question in the list of everything waiting, in each state`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const { drawer, requests } = await openQuestion(page, waitingAndLate())
      await page.keyboard.press('Escape')
      await expect(drawer).toHaveCount(0)
      await page.getByRole('button', { name: LIST_TITLE }).click()
      const dialog = page.getByRole('dialog', { name: LIST_TITLE })
      await expect(dialog).toHaveCSS('transform', 'none')
      const [top, late] = [
        dialog.locator('.request-card').first(),
        dialog.locator('.request-card').nth(1),
      ]
      await expectRow(top.locator('.request-actions'), `${at} listed`)
      await expectStep(top, `${at} listed`)
      await expectRow(late.locator('.request-actions'), `${at} listed past its deadline`)
      await failSend(top, requests)
      await expectRow(top.locator('.request-actions'), `${at} listed after a failed send`)
    })

    test(`${at}: the asking before a change is dropped puts its buttons at its end, on the column's edge`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const { card } = await openQuestion(page, [answered])
      await card.locator('.request-change').click()
      await card.getByRole('radio').first().check()
      await card.locator('.request-way-out').click()
      await expect(card.locator('.confirm-strip')).toBeVisible()
      await expectStripOnColumn(card.locator('.confirm-strip'), card, `${at} asking`)
    })
  }
