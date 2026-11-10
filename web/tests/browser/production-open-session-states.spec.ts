/**
 * A session's buttons as its state changes under them, in the real app with the plan's
 * route answered: what each agent row is called in every state its parent session can be
 * in, every button of one session learning together what a press found out, and a holder
 * that reads whole where the card has room for it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import {
  agentsInEveryState,
  CRASHED,
  IN_VSCODE,
  markNames,
  openPlanFor,
  shortHolderCard,
} from './openSessionFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

interface Opening {
  always?: string
  /** Where the page's clock starts, installed before the page loads. */
  clock?: string
  locale?: 'en' | 'ru'
  /** A program this computer lacks, where every session that has not ended for good opens. */
  missing?: string
  width?: number
}

/** The plan of a session whose place is a program this computer lacks. */
const lacking = (answer: Record<string, unknown>, host: string) =>
  answer.state === 'gone' || answer.state === 'headless'
    ? answer
    : {
        ...answer,
        opens: null,
        one_action: false,
        steps: [{ kind: 'explain', reason: 'not-installed', host }],
      }

/** The card, with its holder and one agent for each state; `lost` makes one session gone. */
async function openCard(
  page: Page,
  { always, clock, locale = 'en', missing, width = 1280 }: Opening = {},
) {
  await page.setViewportSize({ width, height: 1200 })
  await page.addInitScript(
    ({ language, place }) => {
      localStorage.setItem('valkama-locale', language)
      if (place)
        localStorage.setItem(
          'valkama-settings',
          JSON.stringify({ sessions: { claude: { fallback: 'vscode', always: place } } }),
        )
    },
    { language: locale, place: always },
  )
  const lost = new Set<string>()
  await installBackend(page, {
    agents: agentsInEveryState,
    card: shortHolderCard,
    openPlan: (query) => {
      const planned = openPlanFor(query) as Record<string, unknown>
      const answer = missing ? lacking(planned, missing) : planned
      return lost.has(query.get('session') ?? '')
        ? {
            ...answer,
            state: 'gone',
            opens: null,
            one_action: false,
            steps: [{ kind: 'explain', reason: 'gone', archived: true }],
          }
        : answer
    },
  })
  if (clock) await page.clock.install({ time: new Date(clock) })
  await page.goto(CARD)
  const holder = page.locator('.drawer .card-holder')
  await expect(holder.locator(missing ? '.open-action-still' : 'button.open-action')).toBeVisible()
  return { lost }
}

/** The card's Agents tab, in the language it is open in, and the rows under it. */
async function showAgents(page: Page) {
  const tab = page
    .locator('.drawer .inspector-tabs')
    .getByRole('tab', { name: /^(?:Agents|Агенты) /u })
  await tab.click()
  await expect(page.locator('.drawer .agents')).toBeVisible()
}

/**
 * What the head of each parent's rows is: its button's name, or the words that stand instead
 * of one. Each agent here has a parent of its own, so there is a head for each.
 */
const agentHeads = (page: Page) =>
  page.locator('.drawer .agents .agent-group').evaluateAll((groups) =>
    groups.map((group) => {
      const button = group.querySelector('button.open-action')
      return button
        ? button.getAttribute('aria-label')
        : (group.querySelector('.open-action-still')?.textContent?.trim() ?? '')
    }),
  )

test('every parent’s head is called by its action and its session’s state', async ({ page }) => {
  await openCard(page)
  await showAgents(page)
  await expect(page.locator('.drawer .agents .agent')).toHaveCount(8)
  await expect(page.locator('.drawer .agents .agent button.open-action')).toHaveCount(0)
  await expect
    .poll(() => agentHeads(page))
    .toEqual([
      'Open the parent session in VS Code',
      'Open the parent session in Claude Desktop',
      'Open the parent session — it is running in a terminal: what can be done',
      'session gone',
      'No window · running',
      'Open the parent session in Codex',
      'session folder unknown',
      'Open the parent session — it is running in a terminal: what can be done',
    ])
})

test('in Russian a parent’s head is called by its action too, running or set', async ({ page }) => {
  await openCard(page, { locale: 'ru' })
  await showAgents(page)
  await expect
    .poll(() => agentHeads(page))
    .toContain('Открыть родительскую сессию — она идёт в терминале: что можно сделать')
  for (const name of await agentHeads(page)) expect(name).not.toMatch(/Сессия Открыть/u)
})

test('under "always open in" a parent’s head says the setting chose the place', async ({
  page,
}) => {
  await openCard(page, { locale: 'ru', always: 'cursor' })
  await showAgents(page)
  await expect(page.locator('.drawer .agents button.open-action').first()).toHaveAttribute(
    'aria-label',
    'Открыть родительскую сессию в Cursor — по настройке',
  )
})

test('a press that finds the session gone tells every button of it, and keeps focus', async ({
  page,
}) => {
  const { lost } = await openCard(page)
  await showAgents(page)
  const head = page.locator('.drawer .card-holder')
  const firstAgent = page.locator('.drawer .agents .agent-group').first()
  await expect
    .poll(() => markNames(firstAgent.locator('button.open-action')))
    .toEqual(['Claude Code', 'running'])
  await expect(firstAgent.locator('button.open-action')).toHaveAttribute('aria-label', /VS Code/u)
  lost.add(IN_VSCODE)

  await head.locator('button.open-action').focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('status').filter({ hasText: 'The client no longer has this session.' }),
  ).toHaveCount(1)
  // The holder and the agent whose parent is the same session say it at once.
  await expect(head.locator('.open-action-still')).toContainText('session gone')
  await expect(firstAgent.locator('.open-action-still')).toContainText('session gone')
  await expect(firstAgent.locator('button.open-action')).toHaveCount(0)
  // Another session's row is left as it was.
  await expect(
    page.locator('.drawer .agents .agent-group').nth(1).locator('button.open-action'),
  ).toHaveAttribute('aria-label', /Claude Desktop/u)
  // Focus stays on the holder, now on the way to why it opens nothing.
  await expect(head.locator('.open-action-why')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tooltip')).toContainText('The client no longer has this session.')
})

for (const locale of ['en', 'ru'] as const)
  for (const width of [1500, 390])
    test(`the holder reads whole beside a place the setting chose, ${width}px in ${locale}`, async ({
      page,
    }) => {
      await openCard(page, { always: 'claude-desktop', locale, width })
      const head = page.locator('.drawer .card-holder-value button.open-action')
      await expect
        .poll(() => markNames(head))
        .toContain(locale === 'en' ? 'by your setting' : 'по настройке')
      const name = head.locator('.open-action-name')
      await expect(name).toHaveText('claude · 6f1c2a8e-0000')
      const cut = await name.evaluate((node) => node.scrollWidth > node.clientWidth)
      expect(cut, 'the holder’s name is cut').toBe(false)
      // Nothing of the card reaches past the drawer's edge on a phone either.
      const edges = await head.evaluate((node) => {
        const drawer = node.closest('.drawer')?.getBoundingClientRect()
        return { right: node.getBoundingClientRect().right, edge: drawer?.right ?? 0 }
      })
      expect(edges.right).toBeLessThanOrEqual(edges.edge)
    })

// The session fell silent at 09:15 on the 10th: 2 days 23 hours before the clock's 08:30
// on the 13th, which is 2.97 days and no «2 days».
for (const [locale, silent] of [
  ['en', ', 2\u{A0}d\u{A0}23\u{A0}h ago. It may have crashed'],
  ['ru', ', 2\u{A0}дн.\u{A0}23\u{A0}ч назад. Возможно, она упала'],
] as const)
  test(`a silent session says how long ago in the units the agents use, in ${locale}`, async ({
    page,
  }) => {
    await openCard(page, { clock: '2026-08-13T08:30:00Z', locale })
    await page.locator(`.step-holder button.open-action[aria-description*="${CRASHED}"]`).click()
    await expect(page.locator('.open-panel')).toContainText(silent)
  })

/**
 * How many lines the first run of `words` inside `root` is laid out on, found whatever
 * kind of space stands between its parts, so a span that can break is found broken.
 */
const linesOf = (root: Locator, words: string) =>
  root.evaluate((node, parts) => {
    const escaped = parts.map((part) => part.replaceAll('.', String.raw`\.`))
    const pattern = new RegExp(escaped.join(String.raw`\s`), 'u')
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let at = walker.nextNode(); at; at = walker.nextNode()) {
      const found = pattern.exec(at.textContent ?? '')
      if (!found) continue
      const range = document.createRange()
      range.setStart(at, found.index)
      range.setEnd(at, found.index + found[0].length)
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
    }
    return 0
  }, words.split('\u{A0}'))

// At 07:30 on the 16th the agents last showed activity 2 days 23 hours ago, and the
// silent session fell quiet 5 days 22 hours ago: two units each, on a phone's line.
for (const [locale, agentSpan, silentSpan] of [
  ['en', '2\u{A0}d\u{A0}23\u{A0}h', '5\u{A0}d\u{A0}22\u{A0}h'],
  ['ru', '2\u{A0}дн.\u{A0}23\u{A0}ч', '5\u{A0}дн.\u{A0}22\u{A0}ч'],
] as const)
  test(`a span of two units stays on one line at 390px, in ${locale}`, async ({ page }) => {
    await openCard(page, { clock: '2026-08-16T07:30:00Z', locale, width: 390 })
    await showAgents(page)
    const agent = page.locator('.drawer .agents .agent').first()
    await expect(agent).toContainText(agentSpan)
    expect(await linesOf(agent, agentSpan)).toBe(1)

    await page.locator('.drawer .inspector-tabs').getByRole('tab').first().click()
    await page.locator(`.step-holder button.open-action[aria-description*="${CRASHED}"]`).click()
    const panel = page.locator('.open-panel')
    await expect(panel).toContainText(silentSpan)
    expect(await linesOf(panel, silentSpan)).toBe(1)
  })

for (const [locale, look, first, second] of [
  ['en', 'See it in VS Code:', 'Open the project window in VS Code', 'Open the session in VS Code'],
  ['ru', 'Посмотреть в VS Code:', 'Открыть окно проекта в VS Code', 'Открыть сессию в VS Code'],
] as const)
  test(`each action of a running session's panel names where it leads, in ${locale}`, async ({
    page,
  }) => {
    await openCard(page, { locale })
    await page.locator('.step-holder button.open-action').nth(1).click()
    const panel = page.locator('.open-panel')
    await expect(panel).toContainText(look)
    await expect(panel.getByRole('button')).toHaveText([first, second])
    await expect(page.getByRole('button', { name: first, exact: true })).toBeFocused()
  })

// VS Code missing from this computer is one reason for every session that would open in
// it. It was said beside the holder, every agent and every step; it is said once, and each
// session it stops is marked, the reason in the mark's name.
for (const [locale, said, parent] of [
  ['en', 'VS Code is not installed', 'Open the parent session'],
  ['ru', 'VS Code не установлен', 'Открыть родительскую сессию'],
] as const)
  test(`a program this computer lacks is said once and marked on each session, in ${locale}`, async ({
    page,
  }) => {
    await openCard(page, { locale, missing: 'vscode', width: 1500 })
    await showAgents(page)
    const drawer = page.locator('.drawer')
    await expect(drawer.getByText(said, { exact: false })).toHaveCount(1)
    // The holder, six agents and five steps whose sessions have not ended for good.
    await expect(
      drawer.locator(`.open-action-still .open-action-why[aria-label="${said}."]`),
    ).toHaveCount(12)
    // What a session alone is stays said in its row.
    expect(await agentHeads(page)).toEqual([
      parent,
      parent,
      parent,
      locale === 'en' ? 'session gone' : 'сессии нет',
      locale === 'en' ? 'No window · running' : 'Без окна · идёт',
      parent,
      parent,
      parent,
    ])
  })

/**
 * How far the glyph of each session's why stands from the end of the words before it, or,
 * where those words leave it no room, from the start of the line it begins. Only what the
 * section on show holds: Overview keeps its place in the page while another is up.
 */
const whyGaps = (page: Page) =>
  page.locator('.drawer .open-action-still:visible').evaluateAll((all) =>
    all.map((still) => {
      const glyph = still.querySelector('.open-action-why svg')?.getBoundingClientRect()
      const walker = document.createTreeWalker(still, NodeFilter.SHOW_TEXT)
      let last: DOMRect | undefined
      for (let at = walker.nextNode(); at; at = walker.nextNode()) {
        if (!at.textContent?.trim() || at.parentElement?.closest('.info-tip')) continue
        const range = document.createRange()
        range.selectNodeContents(at)
        last = [...range.getClientRects()].at(-1) ?? last
      }
      if (!glyph || !last) return Number.NaN
      const level = Math.abs(glyph.top + glyph.height / 2 - (last.top + last.height / 2)) <= 4
      if (level) return Math.round(glyph.left - last.right)
      const below = glyph.top >= last.bottom - 1
      return below ? Math.round(glyph.left - still.getBoundingClientRect().left) : Number.NaN
    }),
  )

for (const locale of ['en', 'ru'] as const)
  for (const width of [1500, 390])
    test(`the why of a session that opens nothing stands after its words, ${width}px in ${locale}`, async ({
      page,
    }) => {
      await openCard(page, { locale, missing: 'vscode', width })
      const onOverview = await whyGaps(page)
      await showAgents(page)
      const onAgents = await whyGaps(page)
      // The holder and five steps, then the holder again and six parents.
      expect(onOverview.length).toBeGreaterThan(5)
      expect(onAgents.length).toBeGreaterThan(5)
      const gaps = [...onOverview, ...onAgents]
      expect(gaps.filter((gap) => !(gap >= 0 && gap <= 12))).toEqual([])
    })

test('a holder’s name and what keeps it from opening are told apart', async ({ page }) => {
  await openCard(page)
  const lost = page
    .locator('.drawer .step-holder .open-action-still')
    .filter({ hasText: 'session gone' })
  const inks = await lost.evaluate((still) =>
    ['.open-action-name', '.open-action-place'].map(
      (part) => getComputedStyle(still.querySelector(part) ?? still).color,
    ),
  )
  expect(inks[0]).not.toBe(inks[1])
})

// A holder too long for the facts beside the action wrapped under it and kept the width it
// had before: air stood to the right of its first line. It takes the line under them.
for (const locale of ['en', 'ru'] as const)
  test(`the holder is as wide as its words at 1500px, in ${locale}`, async ({ page }) => {
    await openCard(page, { always: 'claude-desktop', locale, width: 1500 })
    const head = page.locator('.drawer .card-holder-value button.open-action')
    const fit = await head.evaluate((button) => {
      const rects: DOMRect[] = []
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
      for (let at = walker.nextNode(); at; at = walker.nextNode()) {
        const range = document.createRange()
        range.selectNodeContents(at)
        if (at.textContent?.trim()) rects.push(...range.getClientRects())
      }
      // The place and the rest stand as glyphs, which are the words' end as much as a letter.
      for (const mark of button.querySelectorAll('.open-action-mark'))
        rects.push(mark.getBoundingClientRect())
      const box = button.getBoundingClientRect()
      const middles = rects.map((rect) => rect.top + rect.height / 2)
      return {
        lines: Math.max(...middles) - Math.min(...middles) > 4 ? 2 : 1,
        air: Math.round(box.right - Math.max(...rects.map((rect) => rect.right))),
      }
    })
    expect(fit.lines).toBe(1)
    expect(fit.air).toBeLessThanOrEqual(12)
  })
