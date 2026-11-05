import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { asRoot } from '../support/threads.ts'
import { centre } from './boardPage.ts'
import { openQuestion, question } from './questionBackend.ts'

/**
 * What the tests of presses on questions share: a real mouse, and two questions stacked so
 * that folding the upper one lifts the lower one to where the pointer stands.
 */
export type Point = { x: number; y: number }

export const UPPER = '44444444-4444-4444-8444-444444444441'
export const LOWER = '44444444-4444-4444-8444-444444444442'
export const LOWER_DECLINE = "The lower question: Don't answer"
export const THIRD = '44444444-4444-4444-8444-444444444443'

/** A question ended by someone else, as the next read brings it. */
export const answeredElsewhere = {
  status: 'answered',
  answers: { route: 'choice-1' },
  own: {},
  field_notes: {},
  answer_version: 1,
  answered_by: 'another agent',
  by_person: false,
  resolved_at: '2026-10-24T10:30:00Z',
} as const

/**
 * A question someone else withdrew, as the next read brings it. It folds to one line, which
 * is what lifts what stands below: an answered one keeps its options on screen and hardly moves.
 */
export const closedElsewhere = {
  status: 'declined',
  answered_by: 'another agent',
  by_person: false,
  resolved_at: '2026-10-24T10:30:00Z',
} as const

export const choices = (count: number): InputRequestField => ({
  id: 'route',
  label: 'Route',
  type: 'choice',
  required: true,
  options: Array.from({ length: count }, (_, index) => ({
    id: `choice-${index + 1}`,
    label: `Choice ${index + 1}`,
  })),
})

export const pair = (upper: number, lower: number) => [
  question({
    request_id: UPPER,
    prompt: 'The upper question',
    fields: [choices(upper)],
    created_at: '2026-10-24T11:00:00Z',
  }),
  question({
    request_id: LOWER,
    prompt: 'The lower question',
    fields: [choices(lower)],
    created_at: '2026-10-24T10:00:00Z',
  }),
]

export const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))

export const decline = (scope: Locator) =>
  scope.getByRole('button', { name: "Don't answer", exact: true })

/** One press where the pointer is, down and up; the browser counts a second one as `clickCount`. */
export async function press(page: Page, at: Point, clickCount = 1) {
  await page.mouse.move(at.x, at.y)
  await page.mouse.down({ clickCount })
  await page.mouse.up({ clickCount })
}

/** What a press at this point would land on: the question it is in, and the control. */
export const under = (page: Page, at: Point) =>
  page.evaluate(({ x, y }) => {
    const control = document.elementFromPoint(x, y)?.closest('button, label')
    const prompt = control?.closest('.request-card')?.querySelector('.request-prompt')
    const named = control?.getAttribute('aria-label') ?? control?.textContent?.trim()
    return `${prompt?.textContent?.trim()}: ${named}`
  }, at)

/**
 * Brought into view by no more than it takes, as a person scrolls down to the foot of a
 * question. Below it the last of the card then rises to just where the pointer is.
 */
export async function inReach(control: Locator) {
  await control.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'nearest' }))
  return centre(control)
}

/**
 * Two questions in a card, with their foot in reach of the mouse, and the upper one holding
 * as many options as bring the foot of the lower one up to the pointer as it folds.
 */
export async function inCard(page: Page, upper = 5, lower = 2) {
  await page.setViewportSize({ width: 1680, height: 1050 })
  const opened = await openQuestion(page, pair(upper, lower))
  const top = opened.card.filter({ hasText: 'The upper question' })
  const next = opened.card.filter({ hasText: 'The lower question' })
  return { ...opened, at: await inReach(decline(top)), next, top }
}

/** In the middle of the view, as a person brings up what they mean to press next. */
export async function inMiddle(control: Locator) {
  await control.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center' }))
  return centre(control)
}

const OLD_COMMENTS = 8

export const asked = (id: string, prompt: string, options: number, hour: number) =>
  question({
    request_id: id,
    prompt,
    fields: [choices(options)],
    created_at: `2026-10-24T${String(hour).padStart(2, '0')}:00:00Z`,
  })

/**
 * Three questions, the first with this many options, over a thread long enough that folding
 * the first lifts the others by all it gives up instead of running out of page.
 */
export async function threeInCard(page: Page, first: number, width = 1680, height = 1050) {
  await page.setViewportSize({ width, height })
  const opened = await openQuestion(page, [
    asked(UPPER, 'The first question', first, 12),
    asked(LOWER, 'The second question', 2, 11),
    asked(THIRD, 'The third question', 2, 10),
  ])
  for (let id = 0; id < OLD_COMMENTS; id++)
    opened.backend.item.comments.push({
      id: 900 + id,
      kind: 'comment',
      ...asRoot,
      author: 'codex',
      at: '2020-01-01T10:00:00Z',
      body: 'An old comment that takes up room. '.repeat(30),
      report: null,
      checklist_item_id: null,
      checklist_item_text: null,
    })
  await opened.stream.signal('agents')
  await expect(opened.drawer.getByText(/An old comment/u).first()).toBeVisible()
  const named = (hasText: string) => opened.card.filter({ hasText })
  return {
    ...opened,
    first: named('The first question'),
    second: named('The second question'),
    third: named('The third question'),
  }
}

export const writesTo = (requests: { writes: { body: Record<string, unknown> }[] }) =>
  requests.writes.map((write) => write.body.id)

/** The list of everything waiting, opened from the card these tests start in. */
export async function inTheList(
  page: Page,
  opened: { drawer: Locator },
  title = 'Needs my answer',
) {
  await page.keyboard.press('Escape')
  await expect(opened.drawer).toHaveCount(0)
  await page.getByRole('button', { name: new RegExp(`^${title}`, 'u') }).click()
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  // Settled, since a step of declining taken while its buttons still move ends at once.
  await expect(dialog).toHaveCSS('transform', 'none')
  const card = dialog.locator('.request-card')
  return {
    card,
    dialog,
    next: card.filter({ hasText: 'The lower question' }),
    top: card.filter({ hasText: 'The upper question' }),
  }
}
