/**
 * The Agent decisions page in the real app, against a double of the server's summary
 * (`decisionsDouble`), at 1280px in English and at 390px in English and in Russian, and its
 * table at every width the shell takes a form at in both languages. The oracle is
 * the page's contract in DESIGN.md: a decision is found by its point and its period, and its
 * card opens over the page on its System events, which Back closes; a long period's thousand
 * decisions stand in one table that scrolls inside its own frame while the bar stays where it
 * was; an empty period says so in the page's words. On the card's System events the event the
 * decision was recorded by carries the decision's mark, the point in the page's words, and an
 * event with no point carries none. Wherever its columns do not fit the frame, at any width, a
 * decision stands as one block whose every part is in the table's frame, when and the point on its
 * first line, its headings still sorting; at no width is a cell past the frame (Rows and tables):
 * stacked by a phone's width alone, the table left «What was decided» past it at 1024 and 760.
 * Each run prints what it measured and keeps a picture of each state.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute, serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { decisionsBack, decisionsDouble } from '../support/decisionsDouble.ts'
import { record, serveTask } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { spaceScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const WORDS = {
  en: {
    count: (count: number) => `${count} decisions`,
    mark: 'Agent’s own decision · Goal closed',
    empty: 'The agents decided nothing on their own in this period',
    events: 'System events',
    open: `Open ${workItemRef.reference} on its System events`,
    point: 'Participation point',
    pointWord: 'Goal closed',
    weeks4: 'Past 4 weeks',
    when: 'When',
  },
  ru: {
    count: (count: number) => `${count} решений`,
    mark: 'Решение агента · Закрытие цели',
    empty: 'За период агенты ничего не решали сами',
    events: 'Системные события',
    open: `Открыть ${workItemRef.reference} на «Системных событиях»`,
    point: 'Точка участия',
    pointWord: 'Закрытие цели',
    weeks4: '4 недели',
    when: 'Когда',
  },
} as const

const SIZES = [
  { lang: 'en', width: 1280, height: 800 },
  { lang: 'en', width: 390, height: 844 },
  { lang: 'ru', width: 390, height: 844 },
] as const

/** The widths the shell takes a form at, where the table must stand in its frame. */
const FIT_SIZES = [1280, 1024, 760, 620, 390].flatMap((width) =>
  (['en', 'ru'] as const).map((lang) => ({ lang, width, height: width < 600 ? 844 : 800 })),
)

/** What a call that proved nobody carries on an event. */
const UNPROVED = { state: 'unconfirmed', source: null, session_id: null, agent_id: null }

/** The card's history: its claim, and the goal's close the sought decision recorded. */
function cardEvents(at: string) {
  return [
    { action: 'claimed', detail: '', author: 'codex', at, identity: UNPROVED },
    {
      action: 'transitioned',
      detail: 'dev -> done',
      author: 'codex',
      at,
      identity: UNPROVED,
      point: 'goal_close',
    },
  ]
}

const pageAt = (state: Record<string, string> = {}) =>
  serializePlatformRoute({ module_id: 'decisions', scope: spaceScope, state })

/**
 * The decisions of the last hours, and one older than any week that closed a goal on the
 * fixture's card: the decision a reader looks for, which only the past four weeks reach.
 */
function withSought() {
  const now = new Date()
  const recent = decisionsBack(30, new Date(now.getTime() - 60_000)).map((one) => ({
    ...one,
    point: one.point === 'goal_close' ? ('decision' as const) : one.point,
  }))
  const sought = {
    ...decisionsBack(1, new Date(now.getTime() - 10 * 86_400_000))[0],
    point: 'goal_close' as const,
    event_id: 1,
    item: { reference: workItemRef.reference, title: workItem.title, space: 'MAIN', projects: [] },
    what: `closed ${workItemRef.reference}`,
  }
  return [...recent.map((one) => ({ ...one, event_id: one.event_id + 1 })), sought]
}

async function openPage(
  page: Page,
  size: { height: number; lang: string; width: number },
  decisions: ReturnType<typeof decisionsBack>,
  state: Record<string, string> = {},
) {
  const double = decisionsDouble(decisions)
  const sought = decisions.find((one) => one.item.reference === workItemRef.reference)
  await installBackend(page, {
    decisions: (query) => double.read(query),
    ...(sought ? { events: cardEvents(sought.at) } : {}),
  })
  await serveTask(page)
  await page.setViewportSize({ width: size.width, height: size.height })
  await page.goto(pageAt(state))
  await expect(page.locator('.decisions-page')).toBeVisible()
  return double
}

async function shoot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' })
}

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** Where each element's box starts, by its selector. */
async function starts(page: Page, selectors: readonly string[]) {
  const found: Record<string, number> = {}
  for (const selector of selectors) {
    const box = await page.locator(selector).first().boundingBox()
    found[selector] = box?.x ?? Number.NaN
  }
  return found
}

// Playwright hides scrollbars, and one that arrives narrows the frame on a real screen.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

for (const size of SIZES) {
  const words = WORDS[size.lang]
  const tag = `${size.lang} ${size.width}`

  test.describe(`Agent decisions, ${size.lang} at ${size.width}px`, () => {
    test.use({ locale: size.lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('a decision found by its point and period opens its card on System events', async ({
      page,
    }, info) => {
      const double = await openPage(page, size, withSought())
      const rows = page.locator('.decisions-table tbody tr[data-event]')
      await expect(rows).toHaveCount(30)
      await expect(page.locator('.decisions-table-count')).toHaveText(words.count(30))
      await shoot(page, info, `ready-${tag}`)
      // The bar's periods, the count and the table's frame stand on one left edge.
      const edges = await starts(page, [
        '.decisions-bar .period-bar-periods',
        '.decisions-table-count',
        '.decisions-table .section-table-frame',
      ])
      const lefts = Object.values(edges)
      expect(Math.max(...lefts) - Math.min(...lefts), JSON.stringify(edges)).toBeLessThanOrEqual(1)

      // The point first: this week holds no goal closed, and the page says so.
      await page.getByRole('combobox', { name: words.point }).click()
      await page.getByRole('option', { name: words.pointWord }).click()
      await expect(page.getByText(words.empty)).toBeVisible()
      await expect.poll(() => double.asked.at(-1)?.getAll('point')).toEqual(['goal_close'])

      // The past four weeks reach it.
      await page.getByRole('radio', { name: words.weeks4 }).click()
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText(words.pointWord)
      const view = pageAt({ period: 'weeks4', point: 'goal_close' })
      await expect.poll(() => path(page)).toBe(view)

      await rows.first().getByRole('link', { name: words.open }).click()
      const drawer = page.locator('.drawer')
      await expect(drawer).toContainText(workItem.title)
      await expect(drawer.getByRole('tab', { name: words.events })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      // The decision's event carries its mark, the claim beside it none.
      const marked = drawer.locator('li.entry', { has: page.locator('.entry-point') })
      await expect(marked).toHaveCount(1)
      await expect(marked.locator('.entry-point')).toHaveText(words.mark)
      await expect(drawer.locator('li.entry')).toHaveCount(2)
      const opened = parsePlatformRoute(new URL(page.url()))
      expect(opened.module_id).toBe('decisions')
      expect(opened.state).toEqual({ period: 'weeks4', point: 'goal_close' })
      expect(planningWorkItemRef(opened.entity)).toEqual(workItemRef)
      await shoot(page, info, `card-${tag}`)
      // The mark's sign starts on the edge its event's title starts on.
      const markEdges = await starts(page, ['.drawer .entry-title', '.drawer .entry-point'])
      const markLefts = Object.values(markEdges)
      expect(Math.abs(markLefts[0] - markLefts[1]), JSON.stringify(markEdges)).toBeLessThanOrEqual(
        1,
      )
      await record(info, `decisions edges ${tag}`, { page: edges, mark: markEdges })

      // Back closes the card and gives the page back as it was left.
      await page.goBack()
      await expect(drawer).toBeHidden()
      await expect.poll(() => path(page)).toBe(view)
      await expect(rows).toHaveCount(1)
      await record(info, `decisions found ${tag}`, {
        asked: double.asked.map((query) => query.toString()),
      })
    })

    test('a long period stands in one table that scrolls inside its own frame', async ({
      page,
    }, info) => {
      const double = await openPage(
        page,
        size,
        decisionsBack(1000, new Date(Date.now() - 60_000)),
        {
          period: 'weeks4',
        },
      )
      const rows = page.locator('.decisions-table tbody tr[data-event]')
      await expect(rows).toHaveCount(1000)
      await expect(page.locator('.decisions-table-count')).toHaveText(words.count(1000))
      await shoot(page, info, `long-${tag}`)

      const frame = page.locator('.decisions-table .section-table-frame')
      const bar = page.locator('.decisions-bar')
      const before = await bar.boundingBox()
      const sizes = await frame.evaluate((element) => ({
        client: element.clientHeight,
        scroll: element.scrollHeight,
      }))
      expect(sizes.scroll).toBeGreaterThan(sizes.client)
      await frame.evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
      await expect(rows.last()).toBeInViewport()
      const after = await bar.boundingBox()
      expect(after?.y).toBe(before?.y)
      const outer = await page
        .locator('.module-frame')
        .evaluate((element) => element.scrollHeight - element.clientHeight)
      expect(outer, 'the module frame has nothing to scroll').toBeLessThanOrEqual(1)
      const panel = await page
        .locator('.decisions-panel')
        .evaluate((element) => element.scrollHeight - element.clientHeight)
      expect(panel, 'the panel under the bar has nothing to scroll').toBeLessThanOrEqual(1)
      const frameEnd = await frame.evaluate((element) => element.getBoundingClientRect().bottom)
      expect(frameEnd, 'the frame ends inside the window').toBeLessThanOrEqual(size.height)
      await shoot(page, info, `long-end-${tag}`)
      await record(info, `decisions long ${tag}`, {
        pages: double.asked.map((query) => [query.get('limit'), query.get('offset')]),
        frame: { ...sizes, end: frameEnd, panel },
        bar: { before: before?.y, after: after?.y },
      })
      expect(double.asked.map((query) => query.get('offset'))).toEqual([
        '0',
        '200',
        '400',
        '600',
        '800',
      ])
    })

    test('an empty period says so in the page’s words', async ({ page }, info) => {
      await openPage(page, size, [])
      await expect(page.getByText(words.empty)).toBeVisible()
      await expect(page.locator('.decisions-table')).toHaveCount(0)
      await expect(page.getByRole('radio', { name: words.weeks4 })).toBeVisible()
      await shoot(page, info, `empty-${tag}`)
    })
  })
}

for (const size of FIT_SIZES) {
  const words = WORDS[size.lang]
  const tag = `${size.lang} ${size.width}`

  test.describe(`Agent decisions' table, ${tag}px`, () => {
    test.use({ locale: size.lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('every part of a decision stands in the frame, stacked where its columns do not fit', async ({
      page,
    }, info) => {
      await openPage(page, size, withSought())
      const rows = page.locator('.decisions-table tbody tr[data-event]')
      await expect(rows).toHaveCount(30)
      await page.evaluate(() => document.fonts.ready)
      const frame = page.locator('.decisions-table [data-region="table-frame"]')
      const measured = await frame.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const past = (one: Element) => {
          const own = one.getBoundingClientRect()
          return Math.max(box.left - own.left, own.right - box.right, 0)
        }
        const top = (selector: string) =>
          element.querySelector(`tbody tr[data-event] ${selector}`)?.getBoundingClientRect().top ??
          Number.NaN
        const pastRows = [...element.querySelectorAll('tbody tr[data-event]')].map((row) =>
          Math.max(...[...row.children].map((one) => past(one))),
        )
        const fit = element.closest<HTMLElement>('.decisions-table')?.dataset.fit
        const at = top('.decisions-at')
        // Stacked, when and the point stand on the first line and the card under them; as columns
        // the three share a line, which says nothing here.
        const stacked = fit === 'stack'
        return {
          fit,
          sideways: element.scrollWidth - element.clientWidth,
          cells: Math.max(...pastRows),
          headings: [...element.querySelectorAll('thead th')].map((one) => past(one)),
          firstLine: stacked ? Math.abs(top('.decisions-point') - at) : 0,
          cardUnder: stacked ? top('.decisions-item') - at : 1,
        }
      })
      await record(info, `decisions fit ${tag}`, measured)
      // Every cell of every row and every heading's sort in the frame, nothing to scroll sideways.
      expect(measured.headings).toHaveLength(5)
      for (const past of [measured.cells, ...measured.headings])
        expect.soft(past).toBeLessThanOrEqual(0.5)
      expect(measured.sideways).toBeLessThanOrEqual(0)
      expect.soft(measured.firstLine).toBeLessThanOrEqual(1)
      expect.soft(measured.cardUnder).toBeGreaterThan(0)
      // A phone's frame has no room for five columns of words.
      expect.soft(size.width >= 600 || measured.fit === 'stack', 'stacked on a phone').toBe(true)
      // A heading still sorts: the oldest first.
      await page.getByRole('button', { name: words.when }).click()
      await expect(page.locator('.decisions-table thead th').first()).toHaveAttribute(
        'aria-sort',
        'ascending',
      )
      await shoot(page, info, `fit-${tag}`)
    })
  })
}
