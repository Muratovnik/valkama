/**
 * Which projects a section's figures are of, beside its heading, in the real app over the browser
 * double. The oracle is the requirement (`DESIGN.md`, Analytics): beside the heading of every
 * section the period's figures fill — the overview, a dimension's, the tasks' and the tokens' —
 * the quiet words say «project <name>», by the name the context bar gives the project, on a page
 * scoped to one, and «all projects» on the global page; the quota's sections say none. At 1440
 * and 1024 pixels, in both languages, the words stand whole on one line in the heading's row,
 * over none of the row's other parts — the heading, its «ⓘ», its controls — and the bar stands
 * as high with them as without, as high on a project's page as on the global one. Each run prints
 * what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openPanel, record, serve, shortfalls } from './analyticsPage.ts'
import { globalScope, projectId, projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

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

const WORDS = {
  en: { project: 'project Example Project', all: 'all projects' },
  ru: { project: 'проект Example Project', all: 'все проекты' },
}

/** The sections the period's figures fill, by the address part that opens each. */
const SPENDING: Record<string, Record<string, string>> = {
  overview: {},
  tasks: { by: 'work_item' },
  models: { by: 'model' },
  tokens: { by: 'token_kind' },
}
const QUOTA = ['quota_five_hour', 'quota_week']

/** The scope's words in the section's heading row, where they stand and what they cover. */
async function measured(page: Page) {
  const head = page.locator('.analytics-panel .level-section > .level-head').first()
  await expect(head).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const short = await shortfalls(
    page,
    '.analytics-panel .level-section > .level-head .section-scope',
  )
  const placed = await head.evaluate((row) => {
    const scope = row.querySelector('[data-part="scope"]')
    const bar = document.querySelector('.analytics-bar')?.getBoundingClientRect()
    const barHeight = Math.round(bar?.height ?? 0)
    if (!scope) return { text: null, lines: 0, inside: false, over: [] as string[], barHeight }
    const box = scope.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(scope)
    const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
    const own = row.getBoundingClientRect()
    const others = [...row.querySelectorAll('.level-heading, .level-about, .level-actions > *')]
    const over = others
      .filter((other) => {
        const rect = other.getBoundingClientRect()
        const wide = Math.min(rect.right, box.right) - Math.max(rect.left, box.left)
        const high = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top)
        return rect.width > 0 && wide > 0.5 && high > 0.5
      })
      .map((other) => other.className)
    return {
      text: scope.textContent?.trim() ?? null,
      lines,
      inside: box.left >= own.left - 0.5 && box.right <= own.right + 0.5,
      over,
      barHeight,
    }
  })
  return { ...placed, short: short.map((one) => one.short) }
}

async function open(
  page: Page,
  scope: typeof globalScope | typeof projectScope,
  state: Record<string, string>,
) {
  await openPanel(page, serializePlatformRoute({ module_id: 'analytics', scope, state }))
  return measured(page)
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [1440, 1024])
    test(`in ${locale} at ${width}px, each spending section names its projects beside its heading and the quota none`, async ({
      page,
    }, info) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await page.setViewportSize({ width, height: 900 })
      await serve(page, WORLD)
      const seen: Record<string, unknown> = {}
      const bars: number[] = []
      for (const [name, state] of Object.entries(SPENDING)) {
        const project = await open(page, projectScope, state)
        const all = await open(page, globalScope, state)
        seen[name] = { project, all }
        expect(project.text, `${name}: the project`).toBe(WORDS[locale].project)
        expect(all.text, `${name}: all projects`).toBe(WORDS[locale].all)
        for (const one of [project, all]) {
          expect(one.lines, `${name}: on one line`).toBe(1)
          expect(one.short, `${name}: the words whole`).toEqual([expect.any(Number)])
          expect(one.short[0] ?? 1, `${name}: the words whole`).toBeLessThanOrEqual(0.5)
          expect(one.inside, `${name}: inside the heading's row`).toBe(true)
          expect(one.over, `${name}: over nothing of the row`).toEqual([])
          bars.push(one.barHeight)
        }
      }
      for (const name of QUOTA) {
        const quota = await open(page, projectScope, { by: name })
        seen[name] = quota
        expect(quota.text, `${name}: no projects`).toBeNull()
        bars.push(quota.barHeight)
      }
      await record(info, `section scope ${locale} ${width}`, seen)
      expect(new Set(bars).size, 'the bar as high everywhere').toBe(1)
    })
