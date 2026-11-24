import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/*
 * When put-off work comes back (`UntilChoice`), read off the built page: a card's «Put off»
 * stacks its fields, a question's «Later…» sets them on a line. Both are held to one rule for
 * the line that says which of a day and a count comes first, so it lives here once.
 */

/** The labels of the choice's fields, in each language. */
export const UNTIL_WORDS = {
  en: { day: 'Until a day', count: 'New comments', card: 'Until a card closes' },
  ru: { day: 'До даты', count: 'Новых комментариев', card: 'До закрытия карточки' },
} as const
type Words = (typeof UNTIL_WORDS)[keyof typeof UNTIL_WORDS]
type Box = { bottom: number; left: number; right: number; top: number }

/** The gap between the rows of the fields. */
const ROW_GAP = 8

/** Each box as one frame draws it, so a window still settling cannot part them. */
async function framed(locators: Locator[]): Promise<Box[]> {
  const first = locators[0]
  if (!first) throw new Error('nothing to measure')
  const handles = await Promise.all(locators.map((locator) => locator.elementHandle()))
  try {
    return await first.page().evaluate(
      (elements) =>
        elements.map((element) => {
          const { bottom, left, right, top } = element.getBoundingClientRect()
          return { bottom, left, right, top }
        }),
      handles,
    )
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()))
  }
}

/** Where `box` stands from `origin`, whatever moves the window both are in. */
const from = (box: Box, origin: Box) => ({ x: box.left - origin.left, y: box.top - origin.top })

const parts = (scope: Locator, words: Words) => [
  scope.getByLabel(words.day),
  scope.getByLabel(words.count),
  scope.getByText(words.card, { exact: true }),
]

/** The day's and the count's fields and the card's, the card's from the top of its label. */
export async function untilFields(scope: Locator, words: Words) {
  const [day, count, card] = await framed(parts(scope, words))
  if (!day || !count || !card) throw new Error('the day, the count or the card is not drawn')
  return { day, count, card }
}

/**
 * The day's, the count's and the card's fields, then each of `also`, from the top left of the
 * box `origin` as one frame draws them: what a change of value must leave where it was.
 */
export async function placesIn(
  origin: Locator,
  scope: Locator,
  words: Words,
  also: Locator[] = [],
) {
  const [frame, ...boxes] = await framed([origin, ...parts(scope, words), ...also])
  if (!frame || boxes.length !== 3 + also.length) throw new Error('a part is not drawn')
  return boxes.map((box) => ({ ...from(box, frame), width: box.right - box.left }))
}

/** Every part of `now` stands where it stood `before`, as wide. */
export function stayedPut(
  now: Awaited<ReturnType<typeof placesIn>>,
  before: Awaited<ReturnType<typeof placesIn>>,
) {
  const seen = JSON.stringify({ now, before })
  expect(now, seen).toHaveLength(before.length)
  for (const [index, place] of now.entries()) {
    const was = before[index]
    if (!was) throw new Error('nothing to compare')
    for (const key of ['x', 'y', 'width'] as const)
      expect(
        Math.abs(place[key] - was[key]),
        `${key} of part ${index}: ${seen}`,
      ).toBeLessThanOrEqual(0.5)
  }
}

/**
 * The line that says which comes first, drawn once a day and a count are both chosen, stands
 * right under the day and the count it qualifies, one row gap below them, across the fields'
 * width. Where the card's field does not stand beside them, the line comes before it: under the
 * card it read as a word about the card. Where it does, the line ends the fields under the card's
 * row. Nothing but the line's own room moves as it appears: from the day, the count stands where
 * `before`, read just before the line appeared, had it, and the card stands there too or lower by
 * the line and one gap.
 */
export async function eitherUnderTheCount(
  scope: Locator,
  words: Words,
  before: Awaited<ReturnType<typeof untilFields>>,
) {
  const line = scope.locator('[data-until="either"]')
  await expect(line).toBeVisible()
  const [day, count, card, either] = await framed([...parts(scope, words), line])
  if (!day || !count || !card || !either) throw new Error('a field or the line is not drawn')
  const seen = JSON.stringify({ day, count, card, either })
  const beside = card.top < count.bottom

  expect(either.top, seen).toBeGreaterThanOrEqual(count.bottom - 0.5)
  expect(either.top - count.bottom, seen).toBeLessThanOrEqual(ROW_GAP + 0.5)
  if (!beside) expect(either.bottom, seen).toBeLessThanOrEqual(card.top + 0.5)
  expect(Math.abs(either.left - day.left), seen).toBeLessThanOrEqual(0.5)
  expect(either.right, seen).toBeGreaterThanOrEqual(
    Math.max(count.right, beside ? card.right : 0) - 0.5,
  )

  const [countNow, countThen] = [from(count, day), from(before.count, before.day)]
  expect(Math.abs(countNow.x - countThen.x), seen).toBeLessThanOrEqual(0.5)
  expect(Math.abs(countNow.y - countThen.y), seen).toBeLessThanOrEqual(0.5)
  const [cardNow, cardThen] = [from(card, day), from(before.card, before.day)]
  const room = beside ? 0 : either.bottom - either.top + ROW_GAP
  expect(Math.abs(cardNow.x - cardThen.x), seen).toBeLessThanOrEqual(0.5)
  expect(Math.abs(cardNow.y - cardThen.y - room), seen).toBeLessThanOrEqual(1)
}
