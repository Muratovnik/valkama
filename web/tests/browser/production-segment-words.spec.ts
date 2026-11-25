/**
 * A segment's words against its room (DESIGN.md, Segmented choice and One-line labels), on the
 * one row of segments whose words come from the store: Participation's scope choice names the
 * space chosen in the context bar by its key, «Space MAIN», and the store takes a key of up to
 * eight letters and digits. A wrapped row's column on a phone is narrower than «Пространство»
 * and eight wide letters: kept on one line and uncut, the words ran 64px past their segment's
 * edge at 320px. Every segment of the page keeps its words inside its room at every width; where
 * its column cuts them they end in an ellipsis and are whole in its hint and its name, and a
 * short key's words are never cut.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { participationDouble } from '../support/participationDouble.ts'
import { installBackend } from './backend.ts'
import { dataScopeId, globalScope, shellSpaceFor } from './planningFixtures.ts'
import { test } from './test.ts'

const SCOPE = { en: 'Scope', ru: 'Область' } as const
const SPACE_WORD = { en: 'Space', ru: 'Пространство' } as const
/** The widest key the store takes, and the fixture's own. */
const LONG_KEY = 'WWWWWWWW'
const SHORT_KEY = 'MAIN'
const WIDE = [1440, 1024, 620, 390] as const

/** Settings → Participation in a space of this key, listed by the shell's context, at `width`. */
async function openIn(page: Page, locale: 'en' | 'ru', key: string, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await installBackend(page)
  const space = { data_scope_id: dataScopeId, space_key: key }
  await page.route(
    (url) => url.pathname === '/api/platform/context',
    (route) =>
      route.fulfill({
        json: {
          interface_version: 'valkama-context',
          scope: globalScope,
          state: {
            interface_version: 'valkama-ui-state',
            status: 'ready',
            payload: {
              primary: { data_scope_id: dataScopeId, is_writable: true },
              spaces: [shellSpaceFor(space)],
              ui_prefs: null,
            },
          },
        },
      }),
  )
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
    // Where the row has room for them the words stand whole.
    for (const width of WIDE) {
      await page.setViewportSize({ width, height: 1000 })
      await expect.poll(() => wordMisses(page), { message: `${width}px` }).toEqual([])
      expect(await isCut(page, words), `${width}px`).toBe(false)
    }
    // At 320px one column is narrower than them: the case this is about.
    await page.setViewportSize({ width: 320, height: 1000 })
    await expect.poll(() => wordMisses(page), { message: '320px' }).toEqual([])
    await expect.poll(() => isCut(page, words)).toBe(true)
    await expect(segment).toHaveAccessibleName(words)
    // The hint lays the whole words over the cut ones (DESIGN.md, Hints).
    await segment.hover()
    await expect(page.locator('.whole-text')).toHaveText(words)
  })
}
