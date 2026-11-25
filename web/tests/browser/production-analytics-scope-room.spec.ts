/**
 * The room a long name takes beside a section's heading, in the real app over the browser double.
 * The oracle is the requirement (`DESIGN.md`, Analytics, and `SectionScope`): which projects the
 * figures are of stands beside the heading of every section the period's figures fill, after its
 * «ⓘ», and a name too long for the room beside the heading wraps in that room and is cut there,
 * its whole words in a hint while they are cut, so the section's choice and what the section holds
 * stand where a short name leaves them. An 85-character space name took the pauses' choice to a
 * line of its own at 1440 pixels, 40px down, and at 1024 the words to a line and the choice to the
 * next, 61px down, the tables with them.
 *
 * Every section the scope's words stand in is measured with a short name and a long one: the
 * overview, the tokens by kind, the pauses and each dimension's, the last two with a choice at the
 * heading row's end (`data-level-actions`). At 1440 and 1024 pixels, in both languages, the choice
 * and what the section holds (`data-level-body`), the pauses' first environment among it, stand as
 * high and as far along with the long name as with the short one; the long words stand on the
 * heading's line after its «ⓘ», within the row, over none of its other parts, on two lines at most
 * and with their whole words as their hint. At a phone's 390 and 320 pixels only that nothing
 * breaks: the words within the row, over none of its parts, and the page with no sideways scroll.
 * Each run prints what it measured, and every check is soft, so a run says every section and part
 * that moved rather than the first.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { PAUSES, pausesAnswer } from '../fixtures/pauses.ts'
import { openPanel, record, serve } from './analyticsPage.ts'
import { globalScope, projectId, shellSpaceFor, spaceRef, spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'

/** How far two edges may stand apart and still be one place: the layout's rounding. */
const NEAR = 0.5

const SHORT = 'Main'
/** 85 characters, as long as the name that moved the pauses' choice. */
const LONG = 'Rover telemetry, mission planning and ground station integration for an example fleet'

const SPACE_WORD = { en: 'space', ru: 'пространство' }

/** An hour of one task on Tuesday under one model, in the project the double holds. */
const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 10, 10),
    group: {
      work_item: task(1, 'One'),
      model: value('model-a'),
      project: { id: projectId, unknown: false },
    },
    spend: { seconds: 3600, tokens: 1000, cost: 1 },
  },
]

/** The sections the scope's words stand in, by the address part that opens each. */
const SECTIONS: Record<string, { choice: boolean; by?: string }> = {
  overview: { choice: false },
  tokens: { by: 'token_kind', choice: false },
  pauses: { by: 'pauses', choice: true },
  ...Object.fromEntries(
    [
      'seat',
      'account',
      'project',
      'work_item',
      'executor',
      'role',
      'launch_class',
      'model',
      'effort',
      'environment',
    ].map((by) => [by, { by, choice: true }]),
  ),
}

/** The context bar's spaces, the one the page reads named `name` at the time of each read. */
async function serveSpace(page: Page, locale: 'en' | 'ru') {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await serve(page, WORLD)
  await page.route('**/api/analytics/pauses?*', (route) =>
    route.fulfill({ json: pausesAnswer(PAUSES) }),
  )
  const named = { name: SHORT }
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
              primary: { data_scope_id: spaceRef.data_scope_id, is_writable: true },
              spaces: [{ ...shellSpaceFor(spaceRef), name: named.name }],
              ui_prefs: null,
            },
          },
        },
      }),
  )
  return named
}

/** The section's heading row and what stands under it, from the section's top edge. */
async function measured(page: Page, section: string) {
  const level = page.locator('.analytics-panel [data-level="section"]').first()
  const head = level.locator(':scope > [data-level-head]')
  await expect(head.locator('[data-part="scope"]')).toBeVisible()
  await expect(level.locator(':scope > [data-level-body]')).toBeVisible()
  if (section === 'pauses') await expect(level.locator('[data-environment]').first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return level.evaluate((root) => {
    const top = root.getBoundingClientRect().top
    const left = root.getBoundingClientRect().left
    const at = (element: Element | null | undefined) => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      return {
        top: box.top - top,
        left: box.left - left,
        right: box.right - left,
        bottom: box.bottom - top,
      }
    }
    const row = root.querySelector(':scope > [data-level-head]')
    const scope = row?.querySelector<HTMLElement>('[data-part="scope"]')
    const heading = row?.querySelector('h1, h2, h3, h4, h5, h6')
    const about = row?.querySelector('[aria-label][aria-controls]')
    const actions = row?.querySelector(':scope > [data-level-actions]')
    const parts = [heading, about, actions].filter((part): part is Element => Boolean(part))
    const words = scope ? at(scope) : null
    const over = parts
      .filter((part) => {
        const box = at(part)
        if (!box || !words) return false
        const wide = Math.min(box.right, words.right) - Math.max(box.left, words.left)
        const high = Math.min(box.bottom, words.bottom) - Math.max(box.top, words.top)
        return wide > 0.5 && high > 0.5
      })
      .map((part) => part.tagName.toLowerCase())
    const lineHeight = scope ? Number.parseFloat(getComputedStyle(scope).lineHeight) : 0
    return {
      text: scope?.textContent.trim() ?? null,
      hint: scope?.dataset.tooltip ?? null,
      lines:
        scope && lineHeight ? Math.round(scope.getBoundingClientRect().height / lineHeight) : 0,
      cut: (scope?.scrollHeight ?? 0) > (scope?.clientHeight ?? 0) + 0.5,
      row: at(row),
      heading: at(heading),
      about: at(about),
      words,
      choice: at(actions),
      body: at(root.querySelector(':scope > [data-level-body]')),
      first: at(root.querySelector('[data-environment]')),
      over,
      sideways: document.documentElement.scrollWidth > window.innerWidth,
    }
  })
}

type Measured = Awaited<ReturnType<typeof measured>>

/** The sections a run keeps a picture of with the long name: the reported one and a dimension's. */
const PICTURED = new Set(['pauses', 'model'])

/** A picture of the page for the run's report, of the sections pictured. */
async function picture(page: Page, info: TestInfo, section: string, name: string) {
  if (PICTURED.has(section))
    await page.screenshot({ path: info.outputPath(`${section}-${name}.png`) })
}

async function open(page: Page, named: { name: string }, name: string, section: string) {
  named.name = name
  const by = SECTIONS[section]?.by
  await openPanel(
    page,
    serializePlatformRoute({ module_id: 'analytics', scope: spaceScope, state: by ? { by } : {} }),
  )
  return measured(page, section)
}

/** The long words within the row and over none of its parts. */
function holdsTogether(name: string, long: Measured) {
  expect.soft(long.words, `${name}: the words`).not.toBeNull()
  const { words, row } = long
  if (!words || !row) return
  expect.soft(words.left, `${name}: within the row`).toBeGreaterThanOrEqual(row.left - NEAR)
  expect.soft(words.right, `${name}: within the row`).toBeLessThanOrEqual(row.right + NEAR)
  expect.soft(words.bottom, `${name}: within the row`).toBeLessThanOrEqual(row.bottom + NEAR)
  expect.soft(long.over, `${name}: over nothing of the row`).toEqual([])
  expect.soft(long.sideways, `${name}: no sideways scroll`).toBe(false)
}

/** The choice, what the section holds and the pauses' first environment, where the short name leaves them. */
function standStill(name: string, short: Measured, long: Measured) {
  for (const part of ['choice', 'body', 'first'] as const) {
    const before = short[part]
    const after = long[part]
    expect.soft(after === null, `${name}: the ${part} with either name`).toBe(before === null)
    if (!before || !after) continue
    expect.soft(Math.abs(after.top - before.top), `${name}: the ${part} as high`).toBeLessThan(NEAR)
    expect
      .soft(Math.abs(after.left - before.left), `${name}: the ${part} as far along`)
      .toBeLessThan(NEAR)
  }
}

/** The long words on the heading's line after its «ⓘ», on two lines at most, whole in a hint. */
function besideHeading(name: string, long: Measured) {
  const { words, heading, about } = long
  if (!words || !heading || !about) throw new Error(`${name}: the heading row's parts`)
  expect.soft(words.left, `${name}: after the «ⓘ»`).toBeGreaterThanOrEqual(about.right - NEAR)
  expect.soft(words.top, `${name}: on the heading's line`).toBeLessThan(heading.bottom)
  expect.soft(words.bottom, `${name}: on the heading's line`).toBeGreaterThan(heading.top)
  expect.soft(long.lines, `${name}: two lines at most`).toBeLessThanOrEqual(2)
  expect.soft(long.hint, `${name}: the whole words in a hint`).toBe(long.text)
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1440, 1024])
    test(`in ${locale} at ${width}px, a long name beside a section's heading moves nothing under it`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 })
      const named = await serveSpace(page, locale)
      const seen: Record<string, { long: Measured; short: Measured }> = {}
      for (const [section, { choice }] of Object.entries(SECTIONS)) {
        const short = await open(page, named, SHORT, section)
        const long = await open(page, named, LONG, section)
        await picture(page, info, section, 'long')
        seen[section] = { short, long }
        expect
          .soft(short.text, `${section}: the short words`)
          .toBe(`${SPACE_WORD[locale]} ${SHORT}`)
        expect.soft(long.text, `${section}: the long words`).toBe(`${SPACE_WORD[locale]} ${LONG}`)
        expect.soft(short.cut, `${section}: the short words whole`).toBe(false)
        expect.soft(short.lines, `${section}: the short words on one line`).toBe(1)
        expect.soft(Boolean(short.choice), `${section}: a choice in its heading row`).toBe(choice)
        standStill(section, short, long)
        holdsTogether(section, long)
        besideHeading(section, long)
      }
      expect(Object.keys(seen)).toHaveLength(Object.keys(SECTIONS).length)
      await record(info, `scope room ${locale} ${width}`, seen)
    })

for (const locale of ['en', 'ru'] as const)
  for (const width of [390, 320])
    test(`in ${locale} at ${width}px, a long name beside a section's heading breaks nothing`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 })
      const named = await serveSpace(page, locale)
      const seen: Record<string, Measured> = {}
      for (const section of ['pauses', 'model', 'launch_class']) {
        const long = await open(page, named, LONG, section)
        await picture(page, info, section, 'long')
        seen[section] = long
        expect.soft(long.text, `${section}: the long words`).toBe(`${SPACE_WORD[locale]} ${LONG}`)
        holdsTogether(section, long)
      }
      await record(info, `scope room ${locale} ${width}`, seen)
    })
