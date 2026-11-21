/**
 * How the Analytics sweep walks the page: the address of a view, waiting until a view has
 * settled, the sections, periods and chart views the page itself offers, and opening the value
 * panel from a mark the way a reader does, by pressing it. What is offered is read from the page,
 * so a section or a view added later is walked without a change here.
 */
import type { Page } from '@playwright/test'

import { markPressables, pressPoint } from './sweepPage.ts'

/** A view of the page, as its address holds it. */
export type ViewState = Record<string, string>

/**
 * The measures a view's address may name, as the page's own list has them (`MEASURES` of
 * `analyticsAddress.ts`, which the sweep's unit test holds this to): the sweep runs under Node,
 * which does not resolve the page's `@/` imports.
 */
export const MEASURES: readonly string[] = ['time', 'tokens', 'cost']

/** A period the page offers, as the address holds it once it is chosen. */
export type PeriodChoice = Partial<Record<'from' | 'to', string>> & { period: string }

/** A chart of the panel and the views its switch offers, by their position. */
export interface ChartViews {
  chart: number
  chosen: number
  options: number
}

/** The page's address of `view`: its state as canonical JSON in base64url, as the route writes it. */
function addressOf(base: string, view: ViewState): string {
  const pairs = Object.keys(view)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(view[key])}`)
  const state = Buffer.from(`{${pairs.join(',')}}`).toString('base64url')
  return new URL(`modules/analytics/global?state=${state}`, base).href
}

/** The view the page's address holds now. */
function viewNow(page: Page): ViewState {
  const state = new URL(page.url()).searchParams.get('state')
  return state ? (JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as ViewState) : {}
}

/**
 * Waits until the page has answered and stopped changing: the panel shown, nothing busy, and the
 * same hinted elements, panel height and words over three reads in a row. A view that never
 * settles is measured as it stands after `limit` ms, and the caller is told.
 */
async function settle(page: Page, limit = 20_000): Promise<boolean> {
  const started = Date.now()
  let last = ''
  let same = 0
  while (Date.now() - started < limit) {
    const now = await page.evaluate(() => {
      const panel =
        document.querySelector('.analytics-detail') ?? document.querySelector('.analytics-panel')
      if (!panel || document.querySelector('[aria-busy="true"]')) return ''
      const hinted = document.querySelectorAll('[data-tooltip]').length
      return `${hinted}|${panel.scrollHeight}|${panel.textContent?.length}`
    })
    same = now && now === last ? same + 1 : 0
    last = now
    if (same >= 2) return true
    await page.waitForTimeout(200)
  }
  return false
}

/**
 * Opens `view` and waits for it, opening it once more where it did not settle, as a page whose
 * request failed under the sweep's load is; a narrow page is asked to show the section beside its
 * list. Answers whether it settled.
 */
export async function openView(page: Page, base: string, view: ViewState) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(addressOf(base, { ...view, open: 'section' }))
    if (await settle(page)) return true
  }
  return false
}

/** The sections the rail offers, each by the `by` the address holds once its entry is pressed. */
async function railSections(page: Page): Promise<string[]> {
  const sections: string[] = []
  const entries = page.locator('.analytics-rail button')
  const count = await entries.count()
  for (let index = 0; index < count; index += 1) {
    await entries.nth(index).click()
    await settle(page)
    const by = viewNow(page).by ?? 'overview'
    if (!sections.includes(by)) sections.push(by)
  }
  return sections
}

/** The periods the bar offers: each option of the first group of choices outside rail and panel. */
async function barPeriods(page: Page): Promise<PeriodChoice[]> {
  const periods: PeriodChoice[] = []
  const outside = page.locator(
    'xpath=ancestor::*[contains(@class, "analytics-panel") or contains(@class, "analytics-rail")]',
  )
  const options = page
    .locator('.analytics-page [role="radiogroup"]')
    .filter({ hasNot: outside })
    .first()
    .getByRole('radio')
  const count = await options.count()
  for (let index = 0; index < count; index += 1) {
    await options.nth(index).click()
    await settle(page)
    const { period = 'week', from, to } = viewNow(page)
    const choice: PeriodChoice = { period }
    if (from) choice.from = from
    if (to) choice.to = to
    if (!periods.some((one) => one.period === choice.period)) periods.push(choice)
  }
  return periods
}

/** The sections the rail offers and the periods the bar offers, as the page writes them. */
export async function discover(page: Page, base: string) {
  await openView(page, base, {})
  const sections = await railSections(page)
  await openView(page, base, {})
  return { sections, periods: await barPeriods(page) }
}

/** Every chart section of the panel (`data-shown`) and how many views its switch offers. */
export function chartViews(page: Page): Promise<ChartViews[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.analytics-panel [data-shown]')].map((chart, index) => {
      const radios = [
        ...(chart.querySelector('[role="radiogroup"]')?.querySelectorAll('[role="radio"]') ?? []),
      ]
      const chosen = radios.findIndex((radio) => radio.getAttribute('aria-checked') === 'true')
      return { chart: index, options: radios.length, chosen: Math.max(0, chosen) }
    }),
  )
}

/**
 * Chooses view `option` of chart `chart` and marks that chart as the scope of what is read next
 * (`data-sweep-scope`); answers the view it now shows (`data-shown`).
 */
export async function chooseView(page: Page, chart: number, option: number): Promise<string> {
  const section = page.locator('.analytics-panel [data-shown]').nth(chart)
  await section.locator('[role="radiogroup"] [role="radio"]').nth(option).click()
  await settle(page)
  return page.evaluate((chart) => {
    for (const marked of document.querySelectorAll<HTMLElement>('[data-sweep-scope]'))
      delete marked.dataset.sweepScope
    const charts = document.querySelectorAll<HTMLElement>('.analytics-panel [data-shown]')
    const chosen = charts.item(chart)
    chosen.dataset.sweepScope = ''
    return chosen.dataset.shown ?? '?'
  }, chart)
}

/**
 * Opens the value panel by pressing what a reader would (`markPressables`), at a point the pointer
 * reaches it, until the address holds a panel. A press that did something else is undone by
 * opening the view again. Answers the path of what opened it, or null where nothing did, and how
 * many marks of the charts act when pressed.
 */
export async function openPanel(
  page: Page,
  base: string,
  view: ViewState,
): Promise<{ acting: number; opener: string | null }> {
  const { acting, paths } = await markPressables(page)
  for (const [index, path] of paths.entries()) {
    const at = await pressPoint(page, index)
    if (!at) continue
    await page.mouse.click(at.x, at.y)
    await page.waitForTimeout(400)
    if (viewNow(page).detail) {
      await page.locator('.analytics-detail').first().waitFor()
      await settle(page)
      return { acting, opener: path }
    }
    await openView(page, base, view)
    await markPressables(page)
  }
  return { acting, opener: null }
}
