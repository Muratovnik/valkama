/**
 * The list of work going on now follows running work at a glance: in each space what a
 * session is working on or has waited at for a short while, items and sessions in one run,
 * the one changed last first, each on two lines, the second saying the state, how long and
 * the epic; three folded rows for the rest, each opening in place; the pinned items in a
 * group of their own; and the sessions under no space after the spaces.
 *
 * Measured on the rail at 1280 and in the phone's panel at 390, in English and in Russian:
 * every word keeps one line; a row of one line is as tall as it was (28 on the rail, 44 on a
 * phone) and a row of two lines has the same first line; every sign stands at one x, the
 * second line starts where the title does, and opening a fold moves nothing above it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { liveFrame, liveRow, liveSession, liveSpace } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })
const EPIC = 'Structured answers in one review form'

/** Running, waiting, held, quiet, pinned and closed work, an epic that is only a parent,
 * sessions on no item in a space, one of them waiting for hours, and one under no space. */
function seededFrame() {
  return liveFrame(
    [
      liveSpace(
        'MAIN',
        [
          liveRow('MAIN-4', { kind: 'epic', title: EPIC }),
          liveRow('MAIN-5', {
            title: 'Older work',
            state: 'working',
            updated_at: '2026-11-09T08:00:00Z',
          }),
          liveRow('MAIN-7', {
            title: 'Old migration',
            pinned: true,
            state_name: 'Done',
            is_terminal: true,
          }),
          liveRow('MAIN-12', {
            parent: 'MAIN-4',
            title: 'Answer a review in one form from the phone and the desktop app alike',
            state: 'working',
            agents: 2,
            updated_at: '2026-11-09T09:00:00Z',
          }),
          liveRow('MAIN-13', {
            parent: 'MAIN-4',
            title: 'Tell other work',
            state: 'held',
            updated_at: '2026-11-09T11:00:00Z',
          }),
          liveRow('MAIN-14', {
            title: 'Quiet claim',
            state: 'quiet',
            quiet_since: '2026-11-03T18:02:11Z',
            updated_at: '2026-11-03T18:00:00Z',
          }),
          liveRow('MAIN-20', { title: 'Notes for the owner', pinned: true, state_name: 'Backlog' }),
          liveRow('MAIN-31', {
            title: 'Waiting for a person',
            state: 'waiting',
            updated_at: '2026-11-09T10:00:00Z',
          }),
        ],
        {
          sessions: [
            liveSession('00000000-0000-4000-8000-000000000101'),
            liveSession('00000000-0000-4000-8000-000000000103', { long: true }),
          ],
        },
      ),
      liveSpace('NEXT', [liveRow('NEXT-5', { title: 'Second space work', state: 'working' })]),
    ],
    [liveSession('00000000-0000-4000-8000-000000000102')],
  )
}

/** What the list shows, top to bottom: an item by its reference, a session by its title,
 * else the words of a line. */
function shownLines(list: Locator) {
  return list.evaluate((root) =>
    [
      ...root.querySelectorAll<HTMLElement>(
        '.nav-tree-space-name, .nav-row, .nav-fold-toggle, .nav-tree-note',
      ),
    ]
      .filter((node) => node.checkVisibility())
      .map((node) => {
        if (!node.classList.contains('nav-row')) return (node.textContent ?? '').trim()
        if (node.querySelector('.nav-row-glyph')) {
          return (node.querySelector('.nav-row-title')?.textContent ?? '').trim()
        }
        return node.querySelector('.nav-row-link')?.getAttribute('aria-label')?.split(' ')[0] ?? ''
      }),
  )
}

interface Line {
  /** The middle of the row's sign, or NaN for a row with none. */
  center: number
  /** Where the second line starts, or NaN for a row of one line. */
  detail: number
  /** The middle of the row's title, down from the row's top: where its first line stands. */
  firstLine: number
  /** The folded row of some work. */
  fold: boolean
  height: number
  key: string
  leadless: boolean
  left: number
  /** Lines of text the row's words take: one each. */
  lines: number[]
  /** Where the row's number and its words start: its title, or its epic before it. */
  number: number
  title: number
  top: number
  two: boolean
  width: number
}

/** Every visible row and fold of the list, with its box and how many lines its words take. */
function measure(list: Locator) {
  return list.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('.nav-tree-head, .nav-row, .nav-fold-toggle')]
      .filter((node) => node.checkVisibility())
      .map((node) => {
        const box = node.getBoundingClientRect()
        const words = [
          ...node.querySelectorAll<HTMLElement>(
            '.nav-row-title, .nav-row-epic, .nav-row-detail, .nav-fold-words, .nav-tree-space-name',
          ),
        ]
        const left = (selector: string) =>
          node.querySelector(selector)?.getBoundingClientRect().left ?? Number.NaN
        const sign = node.querySelector('.nav-row-lead .session-sign')?.getBoundingClientRect()
        const title = node.querySelector('.nav-row-title')?.getBoundingClientRect()
        return {
          key:
            node.querySelector('.nav-row-glyph') === null
              ? (node.querySelector('.nav-row-link')?.getAttribute('aria-label')?.split(' ')[0] ??
                (node.textContent ?? '').trim())
              : (node.querySelector('.nav-row-title')?.textContent ?? '').trim(),
          fold: node.classList.contains('nav-fold-toggle'),
          two: node.classList.contains('nav-row-two'),
          leadless: node.classList.contains('nav-row-leadless'),
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          lines: words.map((word) => word.getClientRects().length),
          number: left('.nav-row-number, .nav-row-glyph'),
          title: left('.nav-row-words'),
          detail: left('.nav-row-detail'),
          center: sign ? sign.left + sign.width / 2 : Number.NaN,
          firstLine: title ? title.top + title.height / 2 - box.top : Number.NaN,
        }
      }),
  ) as Promise<Line[]>
}

const near = (one: number, other: number, label: string) =>
  expect(Math.abs(one - other), label).toBeLessThanOrEqual(0.5)

/** Every word on one line; a row of one line as tall as before, a row of two with the same
 * first line; every sign at one x, every title at one x and every second line under its title. */
function holdsTheGrid(lines: Line[], rowHeight: number) {
  const rows = lines.filter((line) => !Number.isNaN(line.title))
  const one = rows.find((line) => !line.two && !line.leadless)
  expect(one, 'a row of one line').toBeDefined()
  expect(rows.some((line) => line.two)).toBe(true)
  for (const line of lines) {
    expect(
      line.lines.every((count) => count === 1),
      `${line.key} wraps`,
    ).toBe(true)
    if (line.two) {
      expect(line.height, `${line.key} has a second line`).toBeGreaterThan(rowHeight)
      near(line.firstLine, one?.firstLine ?? 0, `${line.key} first line`)
      near(line.detail, line.title, `${line.key} second line under the title`)
    } else {
      near(line.height, rowHeight, `${line.key} height`)
      expect(Number.isNaN(line.detail), `${line.key} has one line`).toBe(true)
    }
  }
  const signs = rows.filter((line) => !Number.isNaN(line.center))
  for (const line of signs) near(line.center, signs[0].center, `${line.key} sign`)
  for (const line of rows.filter((each) => !each.leadless)) {
    near(line.title, one?.title ?? 0, `${line.key} title`)
  }
}

async function openRail(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(seededFrame())
  const list = page.locator('.nav-work-list')
  await expect(list.locator('.nav-row').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return list
}

async function openPanel(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(seededFrame())
  await page.locator('.nav-work-rail').click()
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  await settled(panel)
  await page.evaluate(() => document.fonts.ready)
  return panel.locator('.side-panel-body')
}

/** Opening a fold moves nothing down to it and widens nothing; its rows hang under it on
 * one line each, and every fold opened keeps the grid. */
async function opensInPlace(list: Locator, rowHeight: number) {
  const before = await measure(list)
  const held = list.locator('.nav-fold-toggle').first()
  await held.click()
  await expect(held).toHaveAttribute('aria-expanded', 'true')
  const after = await measure(list)
  const fold = before.findIndex((line) => line.fold)
  expect(fold).toBeGreaterThan(0)
  for (const line of before.slice(0, fold + 1)) {
    const same = after.find((each) => each.key === line.key)
    expect(same, line.key).toBeDefined()
    near(same?.top ?? 0, line.top, `${line.key} top`)
    near(same?.left ?? 0, line.left, `${line.key} left`)
    near(same?.width ?? 0, line.width, `${line.key} width`)
  }
  // The held row stands right under its fold, on one line, its epic before its title.
  const at = after.findIndex((line) => line.fold)
  expect(after[at + 1].key).toBe('MAIN-13')
  expect(Math.abs(after[at + 1].top - (after[at].top + after[at].height))).toBeLessThanOrEqual(2)
  await expect(
    list
      .locator('.nav-row', { has: list.page().locator('[aria-label^="MAIN-13 "]') })
      .locator('.nav-row-epic'),
  ).toHaveText(EPIC)
  const folded = list.locator('.nav-fold-toggle[aria-expanded="false"]')
  while ((await folded.count()) > 0) await folded.first().click()
  await list.page().mouse.move(0, 0)
  holdsTheGrid(await measure(list), rowHeight)
}

/** The epic is said on its item's second line, not as a row of its own nor before the title. */
async function epicOnSecondLine(list: Locator) {
  const row = list.locator('.nav-row', { has: list.page().locator('[aria-label^="MAIN-12 "]') })
  await expect(row.locator('.nav-row-detail')).toContainText(EPIC)
  await expect(row.locator('.nav-row-epic')).toHaveCount(0)
  await expect(list.locator('[aria-label^="MAIN-4 "]')).toHaveCount(0)
}

for (const { locale, words } of [
  {
    locale: 'en-US',
    words: {
      held: '1 more with a working session',
      long: '1 more waiting for hours',
      quiet: '1 more silent for over a day',
      pinned: 'Pinned',
      elsewhere: 'Sessions outside any space',
    },
  },
  {
    locale: 'ru-RU',
    words: {
      held: 'ещё 1\u{A0}у работающей сессии',
      long: 'ещё 1\u{A0}давно ждёт',
      quiet: 'ещё 1\u{A0}молчит больше суток',
      pinned: 'Закреплённые',
      elsewhere: 'Сессии вне пространств',
    },
  },
]) {
  const shown = [
    'MAIN · MAIN space',
    'MAIN-31',
    'MAIN-12',
    'MAIN-5',
    'Session 0101',
    words.held,
    words.long,
    words.quiet,
    words.pinned,
    'MAIN-7',
    'MAIN-20',
    'NEXT · NEXT space',
    'NEXT-5',
    words.elsewhere,
    'Session 0102',
  ]

  test.describe(`the list of work going on now, ${locale}`, () => {
    test.use({ locale })

    test('shows the work at hand on two lines, folds the rest and sets the pinned apart, at 1280', async ({
      page,
    }) => {
      const list = await openRail(page)
      expect(await shownLines(list)).toEqual(shown)
      await epicOnSecondLine(list)
      holdsTheGrid(await measure(list), 28)
      await opensInPlace(list, 28)
    })

    test('does the same in the phone’s panel, at 390', async ({ page }) => {
      const body = await openPanel(page)
      expect(await shownLines(body)).toEqual(shown)
      await epicOnSecondLine(body)
      holdsTheGrid(await measure(body), 44)
      await opensInPlace(body, 44)
    })

    test('keeps every row inside the rail at its narrowest', async ({ page }) => {
      const list = await openRail(page)
      const edge = page.locator('.app-nav-shell [role="separator"][aria-valuemin="200"]')
      await edge.focus()
      for (let step = 0; step < 6; step += 1) await page.keyboard.press('ArrowLeft')
      await expect(edge).toHaveAttribute('aria-valuenow', '200')
      for (const each of await list.locator('.nav-fold-toggle').all()) await each.click()
      await page.mouse.move(0, 0)
      const lines = await measure(list)
      holdsTheGrid(lines, 28)
      const overflow = await list.evaluate((root) =>
        [...root.querySelectorAll<HTMLElement>('.nav-row, .nav-row-link, .nav-row-words')]
          .filter((node) => node.scrollWidth > node.clientWidth + 0.5)
          .map((node) => node.className),
      )
      expect(overflow).toEqual([])
      const right = await list.evaluate((root) => root.getBoundingClientRect().right)
      for (const line of lines) {
        expect(line.left + line.width, `${line.key} right`).toBeLessThanOrEqual(right + 0.5)
      }
    })
  })
}
