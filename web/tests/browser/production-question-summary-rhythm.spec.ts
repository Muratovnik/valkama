/**
 * An answered review read by its levels, on the built app at a laptop's width and a phone's,
 * in English and in Russian: a group stands off from the group before it more than a point
 * from a point, a heading belongs to its group, a point's verdict word to its label, a way
 * that opened under a point to that point, and its options to the way's label. Every step is
 * a rung of the spacing ladder. The steps are measured in boxes, not judged from a picture:
 * all of them once stood 12px apart, so a group heading read as one more row of the group above.
 */
import { expect } from '@playwright/test'

import { wayReviewFields, WAYS_PROMPT } from '../support/reviewWays.ts'
import { asked, openQuestion } from './questionBackend.ts'
import { test } from './test.ts'

/** The ladder in `tokens.css`, in pixels: a step between rows is one of its rungs. */
const LADDER = [1, 2, 4, 8, 12, 16, 20, 24, 32, 36, 48, 96]

const POINTS = wayReviewFields.filter((field) => field.type === 'verdict').map(({ id }) => id)
/** Two points not accepted, so no way opens under them, and point follows point directly. */
const OTHERWISE: Partial<Record<string, 'later' | 'reject'>> = { p12: 'later', p17: 'reject' }
const answers = Object.fromEntries(
  POINTS.flatMap((id) => {
    const otherwise = OTHERWISE[id]
    return otherwise
      ? [[id, otherwise]]
      : [
          [id, 'accept'],
          [`${id}-way`, 'head'],
        ]
  }),
)

const answeredReview = () =>
  asked({
    prompt: WAYS_PROMPT,
    fields: wayReviewFields,
    status: 'answered',
    answers,
    field_notes: { p15: 'Only once the head has room for it.' },
    answered_by: 'user',
    by_person: true,
    resolved_at: '2026-10-24T10:30:00Z',
  })

interface Span {
  bottom: number
  top: number
}

/** A point or a field under one, with the boxes it stacks: label and word, or label and options. */
interface Unit {
  box: Span
  items: Span[]
  parts: Span[]
  point: boolean
}

interface Group {
  box: Span
  heading: Span | null
  units: Unit[]
}

/** The boxes of the opened rows. Passed to `evaluate`, so everything it uses is inside it. */
function drawnRows(root: Element): Group[] {
  const span = (node: Element): Span => {
    const { bottom, top } = node.getBoundingClientRect()
    return { bottom, top }
  }
  const unitOf = (unit: Element): Unit => {
    const point = unit.matches('.request-summary-point')
    const parts = point
      ? '.request-summary-label, .request-summary-word'
      : '.request-answer-label, .request-answer-options'
    return {
      box: span(unit),
      items: [...unit.querySelectorAll('.request-answer-options > li')].map((node) => span(node)),
      parts: [...unit.querySelectorAll(parts)].map((node) => span(node)),
      point,
    }
  }
  return [...root.querySelectorAll('.request-summary-group')].map((group) => {
    const heading = group.querySelector('.request-summary-heading')
    const units = group.querySelectorAll('.request-summary-point, .request-summary-under')
    return {
      box: span(group),
      heading: heading ? span(heading) : null,
      units: [...units].map((unit) => unitOf(unit)),
    }
  })
}

/** Each step from the bottom of one box to the top of the next. */
function gaps(spans: readonly Span[]): number[] {
  const found: number[] = []
  let above: Span | undefined
  for (const span of spans) {
    if (above) found.push(span.top - above.bottom)
    above = span
  }
  return found
}

/**
 * The vertical steps of the opened rows: between groups, from a heading to its first point,
 * between points, from a point (or a way under it) to a way under it, from a point's label to
 * its word, from a way's label to its options, and between its options.
 */
function rhythmOf(groups: readonly Group[]) {
  const found = {
    field: [] as number[],
    group: gaps(groups.map(({ box }) => box)),
    heading: groups.flatMap(({ heading, units: [first] }) =>
      heading && first ? [first.box.top - heading.bottom] : [],
    ),
    option: [] as number[],
    options: [] as number[],
    point: [] as number[],
    word: [] as number[],
  }
  for (const { units } of groups) {
    let above: Unit | undefined
    for (const unit of units) {
      if (above) found[unit.point ? 'point' : 'field'].push(unit.box.top - above.box.bottom)
      above = unit
      found[unit.point ? 'word' : 'options'].push(...gaps(unit.parts))
      found.option.push(...gaps(unit.items))
    }
  }
  return found
}

const onLadder = (value: number) => LADDER.some((rung) => Math.abs(rung - value) <= 0.5)
const least = (values: number[]) => Math.min(...values)
const most = (values: number[]) => Math.max(...values)

const CASES = [
  { locale: 'en-US', show: 'Show all 12 rows', word: 'accepted' },
  { locale: 'ru-RU', show: 'Показать все 12 строк', word: 'принято' },
] as const

for (const { locale, show, word } of CASES) {
  test.describe(`an answered review in ${locale}`, () => {
    test.use({ locale })

    for (const width of [1280, 390]) {
      test(`reads by its levels at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        const { card } = await openQuestion(page, [answeredReview()])
        const reply = card.locator('.request-reply')
        await reply.getByRole('button', { name: show, exact: true }).click()
        const rows = reply.locator('.request-summary-rows')
        await expect(rows.locator('.request-summary-heading')).toHaveText([
          'Card',
          'Board',
          'Navigation',
          'Editor',
        ])
        await expect(rows.locator('.request-summary-point').first()).toContainText(word)
        await expect(rows.locator('.request-summary-under')).toHaveCount(10)

        const steps = rhythmOf(await rows.evaluate(drawnRows))
        const seen = `${locale} at ${width}: ${JSON.stringify(steps)}`
        // Every level is present, so no comparison below passes on an empty list.
        expect(steps.group, seen).toHaveLength(3)
        expect(steps.heading, seen).toHaveLength(4)
        expect(steps.point.length, seen).toBeGreaterThanOrEqual(8)
        expect(steps.word, seen).toHaveLength(12)
        expect(steps.field, seen).toHaveLength(10)
        expect(steps.options, seen).toHaveLength(10)
        expect(steps.option.length, seen).toBeGreaterThanOrEqual(20)

        const all = Object.values(steps).flat()
        expect(
          all.filter((value) => !onLadder(value)),
          seen,
        ).toEqual([])

        // A group is set off from its neighbour more than a point from a point.
        expect(least(steps.group), seen).toBeGreaterThan(most(steps.point))
        // A heading belongs to the group under it, not to the one above.
        expect(most(steps.heading), seen).toBeLessThan(least(steps.group))
        expect(most(steps.heading), seen).toBeLessThanOrEqual(least(steps.point))
        // A way under a point belongs to that point.
        expect(most(steps.field), seen).toBeLessThan(least(steps.point))
        // A point's word belongs to its label.
        expect(most(steps.word), seen).toBeLessThan(least(steps.point))
        // Inner steps never outgrow the level holding them.
        expect(most(steps.options), seen).toBeLessThanOrEqual(least(steps.field))
        expect(most(steps.option), seen).toBeLessThanOrEqual(least(steps.field))
      })
    }
  })
}
