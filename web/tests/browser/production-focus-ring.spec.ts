/**
 * The ring says where focus is when the keyboard put it there, or the app moved it after a key.
 * A press of the pointer draws none, nor does focus the app moves in answer to it, since the
 * reader already knows what they pressed: the owner chose no ring after a pointer action. A
 * field shows that it holds focus by its own edge, the same for a press as for Tab.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { focusColour } from './editorPage.ts'
import { frames } from './frames.ts'
import { asked, openQuestion, question, routeField, send } from './questionBackend.ts'
import { inTheList, pair } from './questionPress.ts'
import { test } from './test.ts'

const outline = (target: Locator) => target.evaluate((node) => getComputedStyle(node).outlineStyle)
const edge = (target: Locator) => target.evaluate((node) => getComputedStyle(node).borderTopColor)

const focused = (page: Page) => page.locator('*:focus')

/** The comment field and the frame its editor draws around it. */
function composer(page: Page, drawer: Locator) {
  const named = { name: 'Comment', exact: true }
  return {
    comment: drawer.getByRole('textbox', named),
    frame: drawer.locator('.markdown-surface').filter({ has: page.getByRole('textbox', named) }),
  }
}

const answered = question({
  request_id: '66666666-6666-4666-8666-666666666661',
  prompt: 'Already answered',
  fields: [routeField],
  status: 'answered',
  answers: { route: 'keep' },
  answered_by: 'this client',
  by_person: true,
  resolved_at: '2026-10-24T10:30:00Z',
})

test('a press rings nothing it lands on: a button, how a question ended, its sheet, the comment field', async ({
  page,
}) => {
  const { card, drawer } = await openQuestion(page, [asked(), answered])
  const ended = card.filter({ hasText: 'Already answered' })
  const outcome = ended.locator('.request-state')
  const sheet = card.filter({ hasText: 'Where should the comments go?' })
  const { comment, frame } = composer(page, drawer)
  // Each takes focus from the press, so the absent ring is not an absent focus.
  const tab = drawer.getByRole('tab', { name: 'Overview', exact: true })
  await tab.click()
  await expect(tab).toBeFocused()
  expect(await outline(tab)).toBe('none')
  await outcome.click()
  await expect(ended).toBeFocused()
  expect(await outline(ended)).toBe('none')
  await sheet.locator('.request-meta').click()
  await expect(sheet).toBeFocused()
  expect(await outline(sheet)).toBe('none')
  await comment.click()
  await expect(comment).toBeFocused()
  expect(await outline(frame)).toBe('none')
  expect(await edge(frame)).toBe(await focusColour(page))
})

test('the keyboard rings what it reaches, and a field answers it with its edge alone', async ({
  page,
}) => {
  const { drawer } = await openQuestion(page, [asked()])
  const { comment, frame } = composer(page, drawer)
  const resting = await edge(frame)
  await comment.click()
  // Off the frame, whose hover draws an edge of its own.
  await page.mouse.move(0, 0)
  await page.keyboard.press('Shift+Tab')
  await expect(comment).not.toBeFocused()
  await expect(focused(page)).toHaveJSProperty('tagName', 'BUTTON')
  expect(await outline(focused(page))).toBe('solid')
  expect(await edge(frame)).toBe(resting)
  await page.keyboard.press('Tab')
  await expect(comment).toBeFocused()
  expect(await outline(frame)).toBe('none')
  expect(await edge(frame)).toBe(await focusColour(page))
})

/** What inside `scope` draws an outline of its own, by its classes. */
const ringedInside = (scope: Locator) =>
  scope.evaluate((root) =>
    [...root.querySelectorAll('*')]
      .filter((node) => getComputedStyle(node).outlineStyle !== 'none')
      .map((node) => node.className.toString()),
  )

/** Each way of sending, and the outline the question it lands on draws after it. */
const SENDS = [
  { input: 'a press', act: (control: Locator) => control.click(), ring: 'none' },
  { input: 'a key', act: (control: Locator) => control.press('Enter'), ring: 'solid' },
] as const

for (const width of [1280, 390])
  for (const { input, act, ring } of SENDS)
    test(`focus the app moves after ${input} stays on the question as a whole, at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      const { card } = await openQuestion(page, [asked()])
      await card.getByRole('radio', { name: 'Move them', exact: true }).click()
      await act(send(card))
      // The question folds, and focus stays on it, described by how it ended. After a key it is
      // ringed round the question: round that one line of words the ring stood as a thin capsule.
      await expect(card.locator('.request-state')).toContainText('You answered')
      await expect(card).toBeFocused()
      expect(await outline(card)).toBe(ring)
      expect(await ringedInside(card)).toEqual([])
      await expect(card).toHaveAttribute('aria-describedby', /.+/u)
      const description = await card.evaluate(
        (node) =>
          document.querySelector(`[id="${node.getAttribute('aria-describedby') ?? ''}"]`)
            ?.textContent,
      )
      expect(description).toContain('You answered')
    })

for (const { input, act, ring } of SENDS)
  test(`in the list a press on a heading rings nothing, and answering by ${input} goes to the next question as a whole`, async ({
    page,
  }) => {
    const opened = await openQuestion(page, pair(2, 2))
    const { next, top } = await inTheList(page, opened)
    // The heading is words: a press on it lands on its question, and rings nothing.
    await top.locator('.request-title').click()
    await expect(top).toBeFocused()
    expect(await outline(top)).toBe('none')
    await top.getByRole('radio', { name: 'Choice 1', exact: true }).click()
    await act(send(top))
    // Focus goes to the next question, which its heading names, ringed after a key: a ring round
    // the heading alone stood as a capsule pressed against one line of words.
    await expect(next).toBeFocused()
    expect(await outline(next)).toBe(ring)
    expect(await ringedInside(next)).toEqual([])
    const title = (await next.locator('.request-title').textContent()) ?? ''
    expect(title).not.toBe('')
    await expect(next).toHaveAccessibleName(title)
  })

/** How far the top of `card`, ring and all, stands below the top of the box that scrolls it. */
const topInView = (card: Locator) =>
  card.evaluate((node) => {
    let box = node.parentElement
    while (
      box &&
      !(box.scrollHeight > box.clientHeight && getComputedStyle(box).overflowY !== 'visible')
    )
      box = box.parentElement
    const ring = Number.parseFloat(getComputedStyle(node).outlineOffset) + 2
    return node.getBoundingClientRect().top - ring - (box?.getBoundingClientRect().top ?? 0)
  })

test('in the list the next question above comes into view from its top edge, ring and all', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  const opened = await openQuestion(page, pair(20, 2))
  const { next, top } = await inTheList(page, opened)
  await next.getByRole('radio', { name: 'Choice 1', exact: true }).click()
  // From the keyboard, which rings it, so the ring is in what must come into view.
  await send(next).press('Enter')
  // The question still waiting is the one above, out of sight under the list's top edge.
  await expect(top).toBeFocused()
  expect(await outline(top)).toBe('solid')
  expect(await topInView(top)).toBeGreaterThanOrEqual(0)
})

/** How the ring stands round what holds it: its air from the box and the round of its corners. */
const ringOf = (target: Locator) =>
  target.evaluate((node) => {
    const style = getComputedStyle(node)
    const offset = Number.parseFloat(style.outlineOffset)
    const corners = [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
    ].map((radius) => Number.parseFloat(radius) + offset)
    const control = getComputedStyle(document.documentElement).getPropertyValue('--radius-control')
    return {
      style: style.outlineStyle,
      offset,
      corner: Math.max(...corners),
      control: Number.parseFloat(control),
    }
  })

/** Clear of the words, and turning at a control's corner, so one line never reads as a capsule. */
async function expectLineRing(target: Locator) {
  await expect(target).toBeFocused()
  const ring = await ringOf(target)
  expect(ring.style).toBe('solid')
  expect(ring.offset).toBeGreaterThanOrEqual(4)
  expect(ring.corner).toBeLessThanOrEqual(ring.control)
}

test('why a write or a read failed is ringed clear of its words, at a control corner and not as a capsule', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const opened = await openQuestion(page, [asked()])
  const { card, dialog } = await inTheList(page, opened)
  await page.route('**/api/modules/planning/requests?*', (route) =>
    route.fulfill({ status: 500, json: {} }),
  )
  const refresh = dialog.locator('.request-toolbar').getByRole('button', { name: 'Refresh' })
  // A press takes focus to the reason and rings nothing; the same refresh from a key rings it.
  await refresh.click()
  const failed = dialog.locator('.request-toolbar .request-error')
  await expect(failed).toBeFocused()
  expect(await outline(failed)).toBe('none')
  await refresh.press('Enter')
  await expectLineRing(failed)
  // Across the line up to the refresh, as a failed send is: round the words alone it stood as a chip.
  const button = await refresh.boundingBox()
  const line = await failed.boundingBox()
  const gap = await dialog
    .locator('.request-toolbar')
    .evaluate((node) => Number.parseFloat(getComputedStyle(node).columnGap))
  expect(
    Math.abs((button?.x ?? 0) - gap - ((line?.x ?? 0) + (line?.width ?? 0))),
  ).toBeLessThanOrEqual(1)

  opened.requests.failNext(503)
  await card.getByRole('radio', { name: 'Move them', exact: true }).click()
  await send(card).press('Enter')
  const sent = card.locator('.request-foot .request-error')
  // One line at this width: where a rounder corner closed into a capsule round the words.
  await expect(sent).toBeVisible()
  const box = await sent.boundingBox()
  expect(box?.height ?? 0).toBeLessThan(24)
  await expectLineRing(sent)
})

/** How far the ring round `target` runs past what the window and every box that clips it show. */
const ringCut = (target: Locator) =>
  target.evaluate((node) => {
    const style = getComputedStyle(node)
    const out = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth)
    const box = node.getBoundingClientRect()
    const shown = { top: 0, left: 0, bottom: innerHeight, right: innerWidth }
    for (let at = node.parentElement; at; at = at.parentElement) {
      const clips = getComputedStyle(at)
      if (clips.overflowX === 'visible' && clips.overflowY === 'visible') continue
      const frame = at.getBoundingClientRect()
      const top = frame.top + at.clientTop
      const left = frame.left + at.clientLeft
      shown.top = Math.max(shown.top, top)
      shown.left = Math.max(shown.left, left)
      shown.bottom = Math.min(shown.bottom, top + at.clientHeight)
      shown.right = Math.min(shown.right, left + at.clientWidth)
    }
    return Math.max(
      0,
      shown.top - (box.top - out),
      shown.left - (box.left - out),
      box.bottom + out - shown.bottom,
      box.right + out - shown.right,
    )
  })

/** Where a shot goes when a person asks for shots; a run without the setting takes none. */
async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder) await page.screenshot({ path: `${folder}/${name}.png` })
}

// Focus scrolls a landing just into view, flush with the edge, where the ring standing clear of
// its words was cut: under why a send failed, at the foot of a phone's screen.
for (const locale of ['en', 'ru'] as const)
  test(`${locale} at 390: the ring round why a send failed is whole once focus scrolled it in`, async ({
    page,
  }) => {
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const { card, requests } = await openQuestion(page, [asked()])
    await card.getByRole('radio', { name: 'Move them', exact: true }).check()
    requests.failNext(503)
    await card
      .getByRole('button', { name: locale === 'en' ? 'Send' : 'Отправить', exact: true })
      .press('Enter')
    const sent = card.locator('.request-foot .request-error')
    await expect(sent).toBeFocused()
    await frames(page.locator(':root'))
    expect(await outline(sent)).toBe('solid')
    expect(await ringCut(sent)).toBe(0)
    await shot(page, `send-failed-ring-${locale}-390`)
  })
