import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { InputRequestField } from '@/shared/api/inputRequestModel.ts'

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
    return `${prompt?.textContent?.trim()}: ${control?.textContent?.trim()}`
  }, at)

/**
 * Brought into view by no more than it takes, as a person scrolls down to the foot of a
 * question. Below it the last of the card then rises to just where the pointer is.
 */
export async function inReach(control: Locator) {
  await control.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'nearest' }))
  return centre(control)
}

/** Two questions in a card, with their foot in reach of the mouse. */
export async function inCard(page: Page, upper = 5, lower = 2) {
  await page.setViewportSize({ width: 1680, height: 1050 })
  const opened = await openQuestion(page, pair(upper, lower))
  const top = opened.card.filter({ hasText: 'The upper question' })
  const next = opened.card.filter({ hasText: 'The lower question' })
  return { ...opened, at: await inReach(decline(top)), next, top }
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
  const card = dialog.locator('.request-card')
  return {
    card,
    dialog,
    next: card.filter({ hasText: 'The lower question' }),
    top: card.filter({ hasText: 'The upper question' }),
  }
}
