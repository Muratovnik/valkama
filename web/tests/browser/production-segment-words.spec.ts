/**
 * A segment's words against its room (DESIGN.md, Segmented choice and One-line labels), on the
 * one row of segments whose words come from the store: Participation's scope choice names the
 * space chosen in the context bar by its key, «Space MAIN», and the store takes a key of up to
 * eight letters and digits. A wrapped row's column on a phone is narrower than «Пространство»
 * and eight wide letters: kept on one line and uncut, the words ran 64px past their segment's
 * edge at 320px. Every segment of the page keeps its words inside its room at every width; where
 * its column cuts them they end in an ellipsis and are whole in its hint and its name, and a
 * short key's words are never cut.
 *
 * The longest key's words fit their room at 1440, 1024 and 620px, and not at 320px, where one
 * column is narrower than them, scrollbar or none. At 390px alone whether they fit is read off the
 * room the segment gives them: a scrollbar the panel draws takes room the window would give them,
 * and with one drawn, as a desktop's screen draws it, «Пространство WWWWWWWW» is cut there too.
 * Words that fit stand whole, with no ellipsis and no hint; words that do not end in an ellipsis,
 * whole in the hint. The spec draws the scrollbars; with Playwright's hidden ones the same checks
 * hold.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { participationDouble } from '../support/participationDouble.ts'
import { installBackend } from './backend.ts'
import { dataScopeId, shellSpaceFor } from './planningFixtures.ts'
import { test } from './test.ts'

// Playwright hides scrollbars; the settings panel's own takes room a desktop's screen gives it.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

const SCOPE = { en: 'Scope', ru: 'Область' } as const
const SPACE_WORD = { en: 'Space', ru: 'Пространство' } as const
/** The widest key the store takes, and the fixture's own. */
const LONG_KEY = 'WWWWWWWW'
const SHORT_KEY = 'MAIN'
const WIDE = [1440, 1024, 620, 390] as const

/**
 * Whether the longest key's words fit their segment at each width: the rule's answer where the
 * room is the window's to give, and the room's own at 390px, where a drawn scrollbar decides.
 */
const LONG_FITS: Record<number, boolean | 'by the room'> = {
  1440: true,
  1024: true,
  620: true,
  390: 'by the room',
  320: false,
}

/**
 * Whether the longest key's words fit at `width`: where the rule says, the segment's room is held
 * to it, and at 390px the room's own answer stands.
 */
function fitsAt(width: number, roomHolds: boolean) {
  const pinned = LONG_FITS[width] ?? 'by the room'
  if (pinned === 'by the room') return roomHolds
  expect(roomHolds, `${width}px: the segment's room holds the words whole`).toBe(pinned)
  return pinned
}

/** Settings → Participation in a space of this key, listed by the shell's context, at `width`. */
async function openIn(page: Page, locale: 'en' | 'ru', key: string, width: number) {
  // The hint's delay runs on this clock, so a test can say that no hint came after it.
  await page.clock.install()
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  const space = { data_scope_id: dataScopeId, space_key: key }
  await installBackend(page, { contextSpaces: [shellSpaceFor(space)] })
  const double = participationDouble()
  await page.route(
    (url) => url.pathname === '/api/planning/participation',
    (route) => route.fulfill({ json: double.read(key) }),
  )
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(
    serializePlatformRoute({
      module_id: 'settings',
      scope: { kind: 'space', space_ref: space },
      state: { section: 'participation' },
    }),
  )
  await expect(page.locator('[data-participation-row="set"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const scope = page.getByRole('radiogroup', { name: SCOPE[locale] })
  await expect(scope.getByRole('radio')).toHaveCount(2)
  const words = `${SPACE_WORD[locale]} ${key}`
  return { words, segment: scope.getByRole('radio', { name: words, exact: true }) }
}

/** Each segment of the page: whether its words stand inside its room, are cut, and how. */
const segmentWords = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="radio"], [role="tab"]')].map((segment) => {
      const box = segment.getBoundingClientRect()
      const style = getComputedStyle(segment)
      const start = box.left + Number.parseFloat(style.paddingLeft)
      const end = box.right - Number.parseFloat(style.paddingRight)
      const room =
        box.width - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      let [left, right, laid] = [Infinity, -Infinity, 0]
      let ellipsis = true
      const walker = document.createTreeWalker(segment, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const drawn = range.getBoundingClientRect()
        let [from, to] = [drawn.left, drawn.right]
        let clip: Element | null = null
        // What the boxes that hide their overflow, up to the segment, show of the words.
        for (let at = node.parentElement; at && segment.contains(at); at = at.parentElement) {
          const overflow = getComputedStyle(at).overflowX
          if (overflow !== 'hidden' && overflow !== 'clip') continue
          const shown = at.getBoundingClientRect()
          from = Math.max(from, shown.left)
          to = Math.min(to, shown.right)
          clip ??= at
        }
        left = Math.min(left, from)
        right = Math.max(right, to)
        laid += drawn.width
        if (to - from < drawn.width - 0.5)
          ellipsis &&= clip !== null && getComputedStyle(clip).textOverflow === 'ellipsis'
      }
      return {
        text: segment.textContent?.trim() ?? '',
        inside: left >= start - 0.5 && right <= end + 0.5,
        cut: right - left < laid - 0.5,
        // Whether the segment's room holds its words laid out whole.
        fits: laid <= room + 0.5,
        ellipsis,
        hint: segment.dataset.tooltip ?? null,
        hintKind: segment.dataset.tooltipKind ?? null,
      }
    }),
  )

/** Every segment whose words run past its room, or are cut but by an ellipsis whole in its hint. */
async function wordMisses(page: Page) {
  const segments = await segmentWords(page)
  return segments.length === 0
    ? ['no segment drawn']
    : segments
        .filter(
          (one) =>
            !one.inside ||
            (one.cut && !(one.ellipsis && one.hint === one.text && one.hintKind === 'clipped')),
        )
        .map((one) => JSON.stringify(one))
}

/** Whether the segment of these words is cut. */
const isCut = async (page: Page, words: string) => {
  const segments = await segmentWords(page)
  return segments.find((one) => one.text === words)?.cut
}

/** The segment of these words, as `segmentWords` reads it. */
async function segmentOf(page: Page, words: string) {
  const segments = await segmentWords(page)
  const found = segments.find((one) => one.text === words)
  if (!found) throw new Error(`no segment «${words}»`)
  return found
}

/**
 * Two frames drawn: a row that wraps works its columns out as the resize is drawn
 * (`useSegmentColumns`), so a read before that frame sees the room the last width gave.
 */
const drawn = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      }),
  )

/** The pointer rests on the segment past the hint's delay, from off it. */
async function rest(page: Page, segment: Locator) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  await page.clock.runFor(1000)
  await segment.hover({ timeout: 10_000 })
  await page.clock.runFor(1000)
}

/** The words the hint lays over the segment: its whole words where they are cut, none where not. */
const hintWords = (fits: boolean, words: string) => (fits ? [] : [words])

for (const locale of ['en', 'ru'] as const) {
  test(`a short space key stands whole in its scope segment at every width in ${locale}`, async ({
    page,
  }) => {
    const { words, segment } = await openIn(page, locale, SHORT_KEY, 1440)
    for (const width of [...WIDE, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => wordMisses(page), { message: `${width}px` }).toEqual([])
      expect(await isCut(page, words), `${width}px`).toBe(false)
    }
    await expect(segment).toHaveAccessibleName(words)
  })

  test(`the longest space key stays inside its scope segment at every width in ${locale}`, async ({
    page,
  }) => {
    const { words, segment } = await openIn(page, locale, LONG_KEY, 1440)
    for (const width of [...WIDE, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      await drawn(page)
      await expect
        .poll(() => wordMisses(page), { message: `${width}px`, timeout: 10_000 })
        .toEqual([])
      const { cut, fits: roomHolds } = await segmentOf(page, words)
      const fits = fitsAt(width, roomHolds)
      // Cut where the segment's room is narrower than the words, and only there.
      expect(cut, `${width}px: cut, the words fitting their room: ${fits}`).toBe(!fits)
      await expect(segment, `${width}px`).toHaveAccessibleName(words, { timeout: 10_000 })
      // The hint lays the whole words over cut ones (DESIGN.md, Hints), and none over whole ones.
      await rest(page, segment)
      await expect(page.locator('.whole-text'), `${width}px`).toHaveText(hintWords(fits, words), {
        timeout: 10_000,
      })
    }
  })
}
