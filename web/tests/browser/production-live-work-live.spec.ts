/**
 * The list of work going on now follows running work at a glance: in each space the items
 * a session is working on or waiting at, the one changed last first, each led by its epic's
 * title rather than under an epic row; one folded row for the quiet work, which opens in
 * place; and the pinned items in a group of their own. Measured on the rail at 1280 and in
 * the phone's panel at 390, in English and in Russian: every row keeps one line, and
 * opening the folded row moves nothing above it and widens nothing.
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

/** Running, waiting, held, quiet, pinned and closed work, and an epic that is only a parent. */
function seededFrame() {
  return liveFrame(
    [
      liveSpace(
        'MAIN',
        [
          liveRow('MAIN-4', { kind: 'epic', title: 'Structured answers in one review form' }),
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
        { sessions: [liveSession('00000000-0000-4000-8000-000000000101')] },
      ),
      liveSpace('NEXT', [liveRow('NEXT-5', { title: 'Second space work', state: 'working' })]),
    ],
    [liveSession('00000000-0000-4000-8000-000000000102')],
  )
}

/** What the list shows, top to bottom: a row by its reference, else the words of a line. */
function shownLines(list: Locator) {
  return list.evaluate((root) =>
    [
      ...root.querySelectorAll<HTMLElement>(
        '.nav-tree-space-name, .nav-row, .nav-quiet-fold, .nav-tree-note',
      ),
    ]
      .filter((node) => node.checkVisibility())
      .map((node) =>
        node.classList.contains('nav-row')
          ? (node.querySelector('.nav-row-link')?.getAttribute('aria-label')?.split(' ')[0] ?? '')
          : (node.textContent ?? '').trim(),
      ),
  )
}

interface Line {
  /** The folded row of the quiet work. */
  fold: boolean
  height: number
  key: string
  left: number
  /** Lines of text the row's words take: one each. */
  lines: number[]
  /** Where the row's number and title start. */
  number: number
  title: number
  top: number
  width: number
}

/** Every visible row and fold of the list, with its box and how many lines its words take. */
function measure(list: Locator) {
  return list.evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>('.nav-tree-head, .nav-row, .nav-quiet-fold')]
      .filter((node) => node.checkVisibility())
      .map((node) => {
        const box = node.getBoundingClientRect()
        const words = [
          ...node.querySelectorAll<HTMLElement>(
            '.nav-row-title, .nav-row-epic, .nav-quiet-words, .nav-tree-space-name',
          ),
        ]
        return {
          key:
            node.querySelector('.nav-row-link')?.getAttribute('aria-label')?.split(' ')[0] ??
            (node.textContent ?? '').trim(),
          fold: node.classList.contains('nav-quiet-fold'),
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          lines: words.map((word) => word.getClientRects().length),
          number: node.querySelector('.nav-row-number')?.getBoundingClientRect().left ?? Number.NaN,
          title: node.querySelector('.nav-row-title')?.getBoundingClientRect().left ?? Number.NaN,
        }
      }),
  ) as Promise<Line[]>
}

function oneLineEach(lines: Line[], rowHeight: number) {
  for (const line of lines) {
    expect(
      line.lines.every((count) => count === 1),
      `${line.key} wraps`,
    ).toBe(true)
    expect(Math.abs(line.height - rowHeight), `${line.key} height`).toBeLessThanOrEqual(0.5)
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

/** Opening the fold moves nothing down to it and widens nothing; the quiet rows hang under it. */
async function opensInPlace(list: Locator, rowHeight: number) {
  const before = await measure(list)
  const more = list.locator('.nav-quiet-fold')
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  const after = await measure(list)
  const fold = before.findIndex((line) => line.fold)
  expect(fold).toBeGreaterThan(0)
  const upToFold = before.slice(0, fold + 1)
  for (const line of upToFold) {
    const same = after.find((each) => each.key === line.key)
    expect(same, line.key).toBeDefined()
    expect(Math.abs((same?.top ?? 0) - line.top), `${line.key} top`).toBeLessThanOrEqual(0.5)
    expect(Math.abs((same?.left ?? 0) - line.left), `${line.key} left`).toBeLessThanOrEqual(0.5)
    expect(Math.abs((same?.width ?? 0) - line.width), `${line.key} width`).toBeLessThanOrEqual(0.5)
  }
  // The number column is as wide with the quiet rows shown as without: no title moves.
  for (const line of before.filter((each) => !Number.isNaN(each.title))) {
    const same = after.find((each) => each.key === line.key)
    expect(Math.abs((same?.title ?? 0) - line.title), `${line.key} title`).toBeLessThanOrEqual(0.5)
  }
  oneLineEach(after, rowHeight)
  // The quiet rows stand right under the fold, the one changed last first.
  const at = after.findIndex((line) => line.fold)
  expect(after.slice(at + 1, at + 3).map((line) => line.key)).toEqual(['MAIN-13', 'MAIN-14'])
  expect(Math.abs(after[at + 1].top - (after[at].top + after[at].height))).toBeLessThanOrEqual(2)
}

for (const { locale, words } of [
  {
    locale: 'en-US',
    words: { quiet: '2 more quiet', pinned: 'Pinned' },
  },
  {
    locale: 'ru-RU',
    words: { quiet: 'ещё 2\u{A0}тихие', pinned: 'Закреплённые' },
  },
]) {
  test.describe(`the list of work going on now, ${locale}`, () => {
    test.use({ locale })

    test('shows the work at hand freshest first, folds the quiet work and sets the pinned apart, at 1280', async ({
      page,
    }) => {
      const list = await openRail(page)
      expect(await shownLines(list)).toEqual([
        'MAIN · MAIN space',
        'MAIN-31',
        'MAIN-12',
        'MAIN-5',
        words.quiet,
        words.pinned,
        'MAIN-7',
        'MAIN-20',
        'NEXT · NEXT space',
        'NEXT-5',
      ])
      // The epic is the muted start of its item's row, not a row of its own.
      const epic = list.locator('.nav-row', { has: page.locator('[aria-label^="MAIN-12 "]') })
      await expect(epic.locator('.nav-row-epic')).toHaveText(
        'Structured answers in one review form',
      )
      await expect(list.locator('[aria-label^="MAIN-4 "]')).toHaveCount(0)
      oneLineEach(await measure(list), 28)
      await opensInPlace(list, 28)
    })

    test('does the same in the phone’s panel, at 390', async ({ page }) => {
      const body = await openPanel(page)
      expect(await shownLines(body)).toEqual([
        'MAIN · MAIN space',
        'MAIN-31',
        'MAIN-12',
        'MAIN-5',
        words.quiet,
        words.pinned,
        'MAIN-7',
        'MAIN-20',
        'NEXT · NEXT space',
        'NEXT-5',
      ])
      oneLineEach(await measure(body), 44)
      await opensInPlace(body, 44)
    })
  })
}
