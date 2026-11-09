/**
 * Icons that end a line of words, read off the built page in both languages at a laptop's width
 * and a phone's: the heads of a discussion's entries and of a question, the points of a review,
 * the label of a field and a review group's heading, and the press that opens an option's
 * description at the end of its label, in a question and in a list under a comment. Each icon's strokes are centred on the first
 * line of the words beside it, however many lines those take and however tall the icon's target
 * is (DESIGN.md), in every state the row has, and each target keeps its size. A head of one line,
 * where the first line is the whole of its words, stays as tall as its icons.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { REVIEW_PROMPT, reviewFields } from '../support/reviewQuestion.ts'
import { boxes, listEntry, openList } from './commentListBackend.ts'
import { openCard } from './editorPage.ts'
import { expectIconsOnFirstLine, expectWrapped } from './lineEnd.ts'
import { asked, openQuestion, routeField } from './questionBackend.ts'
import { test } from './test.ts'
import { talkedOn } from './threadFixtures.ts'

const LONG =
  'P1 A point whose label runs long enough to take two lines beside its presses on a laptop ' +
  'and more of them on a phone, so that its first line and its block are not the same'

async function inLocale(page: Page, locale: string, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width, height: 900 })
}

/** The size of an entry's and a field's comment target: a finger's on a phone. */
const inline = (width: number) => (width === 390 ? 44 : 28)

/** Every icon of the rows stands in a target of one of the sizes given. */
function expectTargets(
  measured: Awaited<ReturnType<typeof expectIconsOnFirstLine>>,
  sizes: number[],
  what: string,
) {
  for (const row of measured)
    for (const mark of row.marks) {
      expect(sizes, `${what}: «${mark.name}» keeps its target`).toContain(
        Math.round(mark.target.height),
      )
      expect(Math.round(mark.target.width), `${what}: «${mark.name}» square`).toBe(
        Math.round(mark.target.height),
      )
    }
}

const heads = (scope: Locator) => scope.locator('.entry-head')
const HEAD = ['.entry-words', '.entry-actions button svg'] as const
const OPTION = ['.request-option-words', '.request-option-toggle svg'] as const

/** A description that runs on, so its option shows an excerpt and the press that opens it. */
const RUNS_ON = 'It runs on.\n\nTo a second paragraph,\n\nand a third.'

/** The list under its comment, its option that folds named at a length that wraps. */
function longList() {
  const entry = listEntry()
  const fields = entry.request.fields.map((field) => ({
    ...field,
    options: field.options.map((option) =>
      option.description ? { ...option, label: LONG } : option,
    ),
  }))
  return listEntry({ fields })
}

for (const locale of ['en', 'ru'])
  for (const width of [1280, 390]) {
    const at = `${locale} at ${width}`

    test(`${at}: the heads of a discussion's entries, folded and open`, async ({ page }) => {
      await inLocale(page, locale, width)
      const opened = await openCard(page)
      opened.backend.item.comments.push(...talkedOn())
      await page.reload()
      const { drawer } = opened
      await expect(drawer.locator('.thread-entry').first()).toBeVisible()
      await expect(drawer).toHaveCSS('transform', 'none')
      const atRest = await expectIconsOnFirstLine(heads(drawer), ...HEAD, `${at} at rest`)
      expectWrapped(atRest, `${at} at rest`)
      expectTargets(atRest, [inline(width)], at)
      for (const row of atRest.filter((head) => head.lines === 1 && head.marks.length))
        expect(Math.round(row.height), `${at}: a head of one line is as tall as its icons`).toBe(
          inline(width),
        )
      // The mark of a resolved thread folds it and brings it back.
      const fold = drawer.locator('.thread-entry .entry-actions button[aria-expanded]').first()
      await fold.click()
      await expectIconsOnFirstLine(heads(drawer), ...HEAD, `${at} unfolded`)
      await fold.click()
      await expectIconsOnFirstLine(heads(drawer), ...HEAD, `${at} folded again`)
    })

    test(`${at}: the head of a question, answered and while its answer is changed`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const { card } = await openQuestion(page, [
        asked({
          status: 'answered',
          answers: { route: 'move' },
          resolved_at: '2026-10-24T12:00:00Z',
        }),
      ])
      const head = heads(card)
      expectTargets(
        await expectIconsOnFirstLine(head, ...HEAD, `${at} answered`),
        [inline(width)],
        at,
      )
      await card.locator('.request-change').click()
      await expect(card.locator('.request-onward')).toBeVisible()
      await expectIconsOnFirstLine(head, ...HEAD, `${at} changing`)
    })

    test(`${at}: the points of a review, as given, opened, and with a comment`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const fields = reviewFields.map((field, index) => (index ? field : { ...field, label: LONG }))
      const { card } = await openQuestion(page, [
        asked({ prompt: REVIEW_PROMPT, fields, title: 'Review of the checks' }),
      ])
      await expect(card.locator('.request-point')).toHaveCount(18)
      const rows = card.locator('.request-point-row')
      // The chevron opens the point with the label, so its target is the label's; the comment's
      // press is an icon of its own.
      const point = [
        '.request-point-label',
        '.request-point-glyph, .request-point-tools svg',
      ] as const
      const given = await expectIconsOnFirstLine(rows, ...point, `${at} as given`)
      expectWrapped(given, `${at} as given`)
      const tools = ['.request-point-label', '.request-point-tools svg'] as const
      expectTargets(
        await expectIconsOnFirstLine(rows, ...tools, `${at} its comment`),
        [36, inline(width)],
        at,
      )
      const first = card.locator('.request-point').first()
      await first.locator('.request-point-toggle').click()
      await expectIconsOnFirstLine(rows, ...point, `${at} opened`)
      await first.locator('.request-note-toggle').click()
      await expectIconsOnFirstLine(rows, ...point, `${at} with a comment`)
      // The heading of each group, whose chevron already stood on its first line.
      const group = card.locator('.request-group-toggle')
      await group
        .first()
        .locator('.request-group-title')
        .evaluate((title, words) => {
          title.textContent = words
        }, LONG)
      const glyph = ['.request-group-title', '.request-group-glyph'] as const
      expectWrapped(await expectIconsOnFirstLine(group, ...glyph, `${at} groups`), `${at} groups`)
      await group.first().click()
      await expectIconsOnFirstLine(group, ...glyph, `${at} a group folded`)
    })

    test(`${at}: the label of a field with its comment at the end, and its options`, async ({
      page,
    }) => {
      await inLocale(page, locale, width)
      const options = routeField.options.map((option, index) =>
        index ? option : { ...option, label: LONG, description: RUNS_ON },
      )
      const { card } = await openQuestion(page, [
        asked({
          fields: [
            { ...routeField, label: LONG, options },
            { ...routeField, id: 'second', label: 'Second' },
          ],
        }),
      ])
      const legends = card.locator('.request-legend')
      const legend = [':scope > span', '.request-legend-note svg'] as const
      const shown = await expectIconsOnFirstLine(legends, ...legend, `${at} labels`)
      expectWrapped(shown, `${at} labels`)
      expectTargets(shown, [inline(width)], at)
      const note = card.locator('.request-legend-note').first()
      await note.click()
      await expect(note).toHaveAttribute('aria-expanded', 'true')
      await expectIconsOnFirstLine(legends, ...legend, `${at} a comment open`)
      // An option's press that opens what it runs on to, at the end of its label.
      const rows = card.locator('.request-option')
      const folded = await expectIconsOnFirstLine(rows, ...OPTION, `${at} options`)
      expectWrapped(folded, `${at} options`)
      expectTargets(folded, [36], at)
      await card.locator('.request-option-toggle').first().click()
      await expectIconsOnFirstLine(rows, ...OPTION, `${at} an option opened`)
    })

    test(`${at}: the rows of a list under a comment, ticked, opened and sent`, async ({ page }) => {
      await inLocale(page, locale, width)
      const { list } = await openList(page, [longList()])
      const rows = list.locator('.request-option')
      const toggle = list.locator('.request-option-toggle')
      const form = await expectIconsOnFirstLine(rows, ...OPTION, `${at} a list`)
      expectWrapped(form, `${at} a list`)
      expectTargets(form, [28], at)
      await toggle.click()
      await expectIconsOnFirstLine(rows, ...OPTION, `${at} a list, its row opened`)
      await toggle.click()
      await boxes(list).first().check()
      await list.locator('.request-onward').click()
      await expect(boxes(list)).toHaveCount(0)
      const sent = await expectIconsOnFirstLine(rows, ...OPTION, `${at} a list sent`)
      expectWrapped(sent, `${at} a list sent`)
      expectTargets(sent, [28], at)
      await toggle.click()
      await expectIconsOnFirstLine(rows, ...OPTION, `${at} a list sent, its row opened`)
    })
  }
