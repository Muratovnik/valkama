/**
 * The line «time to triage» in «Needs my answer», at the widths its window changes at and at a
 * phone's in both languages: one per space the read says is due, over the questions of «All»,
 * each whole inside the window and starting at the questions' left edge, with how many of the
 * stack's cards wait unmarked and how long the oldest has waited. Its «Show findings», pressed
 * over «All spaces», closes the window and opens the board of the line's own space filtered by
 * «Awaiting triage»: the cards the line counts, and no other.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { requestList } from '../support/inputRequests.ts'
import { installBackend } from './backend.ts'
import { boardSpace } from './boardFixtures.ts'
import { addressState, chips, serveSpace, shownTiles } from './filterPage.ts'
import { globalScope, spaceRef } from './planningFixtures.ts'
import { installQuestions } from './questionBackend.ts'
import { ofPurpose, openKinds } from './questionKindsPage.ts'
import { test } from './test.ts'

const NOW = Date.parse('2026-11-19T12:00:00Z')
const NBSP = '\u{A0}'
const ALPHA_REF = { data_scope_id: '123e4567-e89b-42d3-a456-426614174001', space_key: 'ALPHA' }
const DUE = [
  {
    space_ref: spaceRef,
    space: { key: 'MAIN', name: 'Main' },
    count: 120,
    oldest_at: '2026-11-16T08:00:00Z',
  },
  {
    space_ref: ALPHA_REF,
    space: { key: 'ALPHA', name: 'Alpha' },
    count: 1,
    oldest_at: '2026-11-19T09:55:00Z',
  },
]
const WORDS = {
  en: [
    `Time to triage · Main: 120 awaiting triage, the oldest for 3${NBSP}d${NBSP}4${NBSP}h`,
    `Time to triage · Alpha: 1 awaiting triage, the oldest for 2${NBSP}h${NBSP}5${NBSP}min`,
  ],
  ru: [
    `Пора разобрать · Main: ждут разбора 120, старшая${NBSP}— 3${NBSP}дн.${NBSP}4${NBSP}ч`,
    `Пора разобрать · Alpha: ждут разбора 1, старшая${NBSP}— 2${NBSP}ч${NBSP}5${NBSP}мин`,
  ],
} as const
/** What the line's action and the condition it opens the board with are called. */
const SHOW = { en: 'Show findings', ru: 'Показать находки' } as const
const AWAITING = { en: 'Awaiting triage', ru: 'Ждёт разбора' } as const
/** Where the line's action stands: beside its words, or, at a phone's width, under them. */
const CASES = [
  { width: 1280, locale: 'en', under: false },
  { width: 620, locale: 'en', under: false },
  { width: 390, locale: 'en', under: true },
  { width: 390, locale: 'ru', under: true },
] as const

/** Where an element stands on the screen; it must be there. */
async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (!found) throw new Error('Not on screen')
  return found
}

/** Where an element's text stands: the box of its text alone, without the element's padding. */
function textEdge(locator: Locator) {
  return locator.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const { left, top, bottom } = range.getBoundingClientRect()
    return { left, top, bottom }
  })
}

/** The read of everything waiting carries these lines; every other read is the backend's. */
async function serveLines(page: Page, entries: Parameters<typeof requestList>[0], due: typeof DUE) {
  await page.route('**/api/modules/planning/requests?**', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('scope_kind') !== 'global' || url.searchParams.get('offset'))
      return route.fallback()
    return route.fulfill({
      json: {
        ...requestList(entries),
        coverage: [{ space_ref: spaceRef, status: 'searched', reason: null }],
        triage_due: due,
      },
    })
  })
}

for (const { width, locale, under } of CASES) {
  test(`at ${width}px in ${locale} a due space's line stands over the questions, whole in the window`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    const entries = [ofPurpose(null), ofPurpose('triage')]
    const { dialog } = await openKinds(page, entries, width, async () => {
      await page.clock.setSystemTime(NOW)
      await serveLines(page, entries, DUE)
    })
    const lines = dialog.locator('[data-triage-due]')
    await expect(lines.locator('[data-triage-due-words]')).toHaveText([...WORDS[locale]])
    await expect(lines.getByRole('button')).toHaveText([SHOW[locale], SHOW[locale]])
    const records = dialog.locator('[data-request-waiting]')
    await expect(records).toHaveCount(2)

    // Each line is whole inside the window, starts where the questions start, and both stand
    // over the first question.
    const column = await box(dialog)
    const first = await box(records.first())
    await expect(lines).toHaveCount(2)
    for (const line of await lines.all()) {
      const { x, y, width: wide, height } = await box(line)
      expect(Math.abs(x - first.x), 'the line starts at the questions’ edge').toBeLessThanOrEqual(1)
      expect(x).toBeGreaterThanOrEqual(column.x - 0.5)
      expect(x + wide).toBeLessThanOrEqual(column.x + column.width + 0.5)
      expect(y + height).toBeLessThanOrEqual(first.y)
      expect(await line.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true,
      )
      // The action stands beside the words, or under them with its words starting on theirs.
      const [words, show] = await Promise.all([
        textEdge(line.locator('[data-triage-due-words]')),
        textEdge(line.getByRole('button')),
      ])
      expect(show.top >= words.bottom, 'the action stands under the words').toBe(under)
      expect(Math.abs(show.left - words.left) <= 1, 'the action starts on the words').toBe(under)
    }
    await dialog.screenshot({ path: testInfo.outputPath(`triage-due-${width}-${locale}.png`) })
  })
}

/**
 * The board's space: of its work in triage, MAIN-402 and MAIN-403 wait in the stack with no
 * review's mark, MAIN-404 waits with one, and the goal MAIN-410 stands outside the stack.
 */
const stacked = () =>
  boardSpace().map((item) => {
    if (item.reference === 'MAIN-404')
      return { ...item, triage_stack: { seen_at: '2026-11-18T10:00:00Z', seen_by: 'worker-a' } }
    if (item.reference === 'MAIN-402' || item.reference === 'MAIN-403')
      return { ...item, triage_stack: { seen_at: null, seen_by: null } }
    return item
  })

for (const { width, locale } of [
  { width: 1280, locale: 'en' },
  { width: 390, locale: 'en' },
  { width: 390, locale: 'ru' },
] as const) {
  test(`at ${width}px in ${locale} «Show findings» over «All spaces» opens the line's space filtered by its cards`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    await page.setViewportSize({ width, height: 900 })
    await page.clock.install()
    await installBackend(page)
    await serveSpace(page, stacked())
    const entries = [ofPurpose(null)]
    await installQuestions(page, entries)
    await page.clock.setSystemTime(NOW)
    // MAIN's line counts its two unmarked cards; it stands after ALPHA's, so the press is not
    // simply the first line's.
    const line = { ...DUE[0], count: 2 }
    await serveLines(page, entries, [DUE[1], line])
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))
    await page.getByRole('button', { name: /^(?:Needs my answer|Ждут моего ответа)/u }).click()
    const dialog = page.getByRole('dialog', { name: /^(?:Needs my answer|Ждут моего ответа)$/u })
    const main = dialog.locator('[data-triage-due="MAIN"]')
    await expect(main.getByRole('button')).toHaveText(SHOW[locale])
    await dialog.screenshot({ path: testInfo.outputPath(`triage-show-${width}-${locale}.png`) })

    await main.getByRole('button', { name: SHOW[locale] }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => addressState(page)).toEqual({ triage: true })
    const url = new URL(page.url())
    expect(parsePlatformRoute(`${url.pathname}${url.search}`).scope).toEqual({
      kind: 'space',
      space_ref: spaceRef,
    })
    await expect(chips(page)).toHaveText([AWAITING[locale]])
    // The board shows the cards the line counts, as many as it says, and no other.
    await expect.poll(() => shownTiles(page)).toEqual(['MAIN-402', 'MAIN-403'])
    expect(line.count).toBe(2)
    await page.screenshot({ path: testInfo.outputPath(`triage-board-${width}-${locale}.png`) })
  })
}
