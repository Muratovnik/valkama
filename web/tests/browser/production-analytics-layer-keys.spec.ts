/**
 * The keys of the layers the Analytics page's charts draw beside their data, in the real app. The
 * oracle is the owner's decision as DESIGN states it in the legend's rule: the mark of the period
 * compared with and the line of an account change, and on a quota step line its pace and its
 * forecast, are layers; each layer's key is a toggle, pressed by the pointer or the keyboard and
 * pressed for assistive technology while its layer shows; one choice per layer holds for every
 * chart that draws it and survives a reload; a layer turned off is not drawn and holds up no
 * scale, while its key stays and the data — the stacked series and their sums, the figures
 * beside them — is the same. The hatch of a period still running is no layer: its key does not
 * act.
 *
 * A week lower than the one before: two hours on a task and one on no task each day, against
 * seven hours a day the week before, so the period before's ticks stand over every column and set
 * the scale. Every id, name and number is made up. Each run attaches what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { noTask, task } from '../fixtures/analytics.ts'
import { quotaOfEdges } from '../fixtures/quota.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { worked } from './overviewPage.ts'
import { test } from './test.ts'

const IMPORT = task(1, 'Import the planning documents')
const LOWER = [
  ...[9, 10, 11].flatMap((day) => [
    worked(day, IMPORT, ['model-a', 'main', 'alpha'], 2),
    worked(day, noTask, ['model-a', 'main', 'alpha'], 1),
  ]),
  ...[2, 3, 4].map((day) => worked(day, IMPORT, ['model-a', 'main', 'alpha'], 7)),
]

const LEGEND = '[data-hint-list="legend"]'
const OUTLINE_KEY = `${LEGEND} [data-mark="outline"]`
const TICKS = '[data-region="field"] [data-mark="before"]'

/** Opens the overview at `width`, its day chart drawn as a chart and its reads landed. */
async function openDays(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 })
  const analytics = await openPanel(page, pageAt())
  const days = analytics.locator('.spending-days')
  await expect(days).toBeVisible()
  await drawLined(days)
  await expect(days.locator(OUTLINE_KEY)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  return days
}

/**
 * What a day chart draws: its days' sums and series in their hints (the period before said
 * apart), how tall each stack stands, the top of its scale and the page's own figure of time.
 */
async function drawnDays(days: Locator) {
  const periods = await days
    .locator('[data-tooltip-area] [data-tooltip]')
    .evaluateAll((all) => all.map((one) => one.dataset.tooltip ?? ''))
  const stacks = await days
    .locator('[data-tooltip-area] [data-hint-mark]')
    .evaluateAll((all) => all.map((one) => Math.round(one.getBoundingClientRect().height)))
  const series = await days
    .locator('[data-tooltip-area] [data-series]')
    .evaluateAll((all) => all.map((one) => one.dataset.series))
  const scale = await days
    .locator('[data-region="scale"] [data-key]')
    .evaluateAll((all) => all.map((one) => Number(one.dataset.key)))
  const figure = await days
    .page()
    .locator('.tile-figure[data-measure="time"]')
    .first()
    .textContent()
  return {
    sums: periods.map((said) => said.replace(/, period before [^\n]*/u, '')),
    before: periods.filter((said) => said.includes('period before')).length,
    stacks,
    series,
    top: Math.max(...scale),
    figure,
  }
}

test('«period before» turned off on the overview is off in a value’s panel too and after a reload, its scale lowered, the data the same', async ({
  page,
}, info) => {
  await serve(page, LOWER)
  const days = await openDays(page, 1440)
  const key = days.locator(OUTLINE_KEY)
  await expect(days.locator(TICKS)).toHaveCount(3)
  await expect(key).toHaveAttribute('aria-pressed', 'true')
  const shown = await drawnDays(days)
  expect(shown.before, 'days whose hint says the period before').toBe(3)

  await key.click()
  await expect(key).toHaveAttribute('aria-pressed', 'false')
  await expect(days.locator(TICKS)).toHaveCount(0)
  const hidden = await drawnDays(days)
  await record(info, 'days with and without the period before', { shown, hidden })
  expect(hidden.before, 'days whose hint says the period before').toBe(0)
  // The same days, sums and series, and the page's own figure beside them.
  expect(hidden.sums).toEqual(shown.sums)
  expect(hidden.series).toEqual(shown.series)
  expect(hidden.figure).toBe(shown.figure)
  // Seven hours a day no longer hold the scale up: it ends lower, and every stack stands taller.
  expect(hidden.top, 'the top of the scale').toBeLessThan(shown.top)
  expect(hidden.stacks).toHaveLength(shown.stacks.length)
  const grown = shown.stacks.flatMap((was, index) =>
    was > 0 ? [{ day: index + 1, was, now: hidden.stacks[index] ?? 0 }] : [],
  )
  expect(grown, 'the days with work').toHaveLength(3)
  expect(grown.filter(({ was, now }) => now <= was)).toEqual([])
  // The key stays, and says it is off by more than a tone.
  await expect(key).toBeVisible()
  await expect(key).toHaveCSS('text-decoration-line', /line-through/u)

  // Another chart that draws the period before: the model's panel, opened in the page.
  await page
    .locator('[data-card="model"]')
    .getByRole('button', { name: 'Details of model-a' })
    .click()
  const panel = page.getByRole('dialog', { name: 'Details: model-a' })
  const panelDays = panel.locator('[data-part="days"]')
  await drawLined(panelDays)
  await expect(panelDays.locator(OUTLINE_KEY)).toHaveAttribute('aria-pressed', 'false')
  await expect(panelDays.locator(TICKS)).toHaveCount(0)
  // The same selector finds the panel's ticks once the layer is on again there.
  await panelDays.locator(OUTLINE_KEY).click()
  await expect(panelDays.locator(OUTLINE_KEY)).toHaveAttribute('aria-pressed', 'true')
  await expect(panelDays.locator(TICKS)).not.toHaveCount(0)
  await panelDays.locator(OUTLINE_KEY).click()
  await expect(panelDays.locator(TICKS)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // Off after a reload, until it is turned on again.
  await page.reload()
  const again = await openDays(page, 1440)
  await expect(again.locator(OUTLINE_KEY)).toHaveAttribute('aria-pressed', 'false')
  await expect(again.locator(TICKS)).toHaveCount(0)
  await again.locator(OUTLINE_KEY).click()
  await expect(again.locator(TICKS)).toHaveCount(3)
})

test('the key of the period before is reached and pressed from the keyboard, and the hatch’s key does not act', async ({
  page,
}) => {
  await serve(page, LOWER)
  const days = await openDays(page, 1440)
  const key = days.locator(OUTLINE_KEY)
  // A control of the page's order: the key it follows hands the focus to it with Tab.
  await key.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(key).not.toBeFocused()
  await page.keyboard.press('Tab')
  await expect(key).toBeFocused()
  await expect(key).toHaveRole('button')
  await page.keyboard.press('Enter')
  await expect(key).toHaveAttribute('aria-pressed', 'false')
  await expect(days.locator(TICKS)).toHaveCount(0)
  await page.keyboard.press('Space')
  await expect(key).toHaveAttribute('aria-pressed', 'true')
  await expect(days.locator(TICKS)).toHaveCount(3)

  // Wednesday afternoon is still running: its day is hatched, and the hatch's key only shows.
  const hatch = days.locator(`${LEGEND} [data-mark="hatch"]`)
  await expect(hatch).toBeVisible()
  expect(await hatch.evaluate((one) => one.matches('button, a[href], [tabindex]'))).toBe(false)
  await expect(hatch).not.toHaveAttribute('aria-pressed', /.*/u)
  const address = page.url()
  await hatch.click()
  await expect(key).toHaveAttribute('aria-pressed', 'true')
  await expect(days.locator(TICKS)).toHaveCount(3)
  expect(page.url()).toBe(address)
})

const LINES = '[data-window] [data-chart="steps"]'

/** Opens the five hours' section drawn as charts, every account read. */
async function openLines(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_five_hour' }))
  await expect(page.locator('[data-account]')).not.toHaveCount(0)
  await drawLined(page.locator('.chart-section').first())
  await page.evaluate(() => document.fonts.ready)
  return page.locator(LINES)
}

/** How many of the lines draw a mark, and how many of their heads name a key, by what each says. */
async function lineLayers(lines: Locator) {
  return lines.evaluateAll((all) =>
    all.map((line) => ({
      corridor: line.querySelectorAll('[data-mark="corridor"]').length,
      reset: line.querySelectorAll('[data-target="reset"]').length,
      even: line.querySelectorAll('[data-mark="even"]').length,
      aheadKey:
        line
          .querySelector('[data-region="head"] [data-key="ahead"]')
          ?.getAttribute('aria-pressed') ?? null,
      evenKey:
        line
          .querySelector('[data-region="head"] [data-key="even"]')
          ?.getAttribute('aria-pressed') ?? null,
    })),
  )
}

test('a quota step line’s forecast and pace turn off on every line from one key, and stay off after a reload', async ({
  page,
}, info) => {
  await serve(page)
  await serveQuota(page, quotaOfEdges(NOW))
  const lines = await openLines(page, 1440)
  const before = await lineLayers(lines)
  const forecasting = before.filter((line) => line.aheadKey !== null)
  const paced = before.filter((line) => line.evenKey !== null)
  // The case holds lines with a forecast and lines with a pace, each drawn and its key pressed.
  expect(forecasting.length, 'lines with a forecast').toBeGreaterThan(1)
  expect(paced.length, 'lines with a pace').toBeGreaterThan(1)
  for (const line of forecasting) expect(line).toMatchObject({ corridor: 1, aheadKey: 'true' })
  for (const line of paced) expect(line).toMatchObject({ even: 1, evenKey: 'true' })

  const first = lines.filter({ has: page.locator('[data-key="ahead"]') }).first()
  await first.locator('[data-region="head"] [data-key="ahead"]').click()
  await first.locator('[data-region="head"] [data-key="even"]').focus()
  await page.keyboard.press('Space')
  const after = await lineLayers(lines)
  await record(info, 'quota lines with and without their layers', { before, after })
  expect(after).toEqual(
    before.map((line) => ({
      ...line,
      corridor: 0,
      reset: 0,
      even: 0,
      aheadKey: line.aheadKey && 'false',
      evenKey: line.evenKey && 'false',
    })),
  )
  // The readings are the data: every line still draws them.
  await expect(lines.locator('[data-mark="line"]')).toHaveCount(await lines.count())

  await page.reload()
  const again = await openLines(page, 1440)
  expect(await lineLayers(again)).toEqual(after)
  await again
    .filter({ has: page.locator('[data-key="ahead"]') })
    .first()
    .locator('[data-region="head"] [data-key="ahead"]')
    .click()
  const back = await lineLayers(again)
  expect(back.map(({ corridor, reset, aheadKey }) => ({ corridor, reset, aheadKey }))).toEqual(
    before.map(({ corridor, reset, aheadKey }) => ({ corridor, reset, aheadKey })),
  )
})

/** Every key of a legend: its box, whether its name is cut, and how its off state is drawn. */
async function keyBoxes(keys: Locator) {
  return keys.evaluateAll((all) =>
    all.map((key) => {
      const box = key.getBoundingClientRect()
      const name = key.querySelector<HTMLElement>('[data-part="name"]') ?? key
      const swatch = key.querySelector('[aria-hidden="true"]')
      return {
        text: name.textContent.trim(),
        box: {
          top: Math.round(box.top),
          left: Math.round(box.left),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
        cut: name.scrollWidth > name.clientWidth + 0.5,
        // The key's own: its words inherit the strike as text does.
        struck: getComputedStyle(key).textDecorationLine,
        faint: swatch ? Number(getComputedStyle(swatch).opacity) : 1,
      }
    }),
  )
}

for (const width of [1440, 1024, 390])
  test(`at ${width}px a layer turned off keeps its key where it stood, whole and drawn as off`, async ({
    page,
  }, info) => {
    await serve(page, LOWER)
    const days = await openDays(page, width)
    const dayKeys = days.locator(`${LEGEND} :is([data-series], [data-mark])`)
    const dayOn = await keyBoxes(dayKeys)
    await days.locator(OUTLINE_KEY).click()
    const dayOff = await keyBoxes(dayKeys)

    await serveQuota(page, quotaOfEdges(NOW))
    const lines = await openLines(page, width)
    const head = lines.filter({ has: page.locator('[data-key="ahead"]') }).first()
    const stepKeys = head.locator('[data-region="head"] [data-key]')
    const stepOn = await keyBoxes(stepKeys)
    await head.locator('[data-key="ahead"]').click()
    const stepOff = await keyBoxes(stepKeys)
    await record(info, `layer keys at ${width}`, { dayOn, dayOff, stepOn, stepOff })

    for (const [on, off, layer] of [
      [dayOn, dayOff, 'period before'],
      [stepOn, stepOff, 'Forecast'],
    ] as const) {
      expect(on.length, 'keys').toBeGreaterThan(1)
      // Nothing moves: every key keeps its box, and none is cut, on or off.
      expect(off.map(({ box }) => box)).toEqual(on.map(({ box }) => box))
      expect([...on, ...off].filter(({ cut }) => cut).map(({ text }) => text)).toEqual([])
      const turned = off.find(({ text }) => text === layer)
      expect(turned, `${layer}'s key`).toBeDefined()
      expect(turned?.struck).toContain('line-through')
      expect(turned?.faint).toBeLessThan(1)
      // Only the key pressed is drawn as off.
      expect(off.filter(({ struck }) => struck.includes('line-through'))).toHaveLength(1)
      expect(on.filter(({ struck }) => struck.includes('line-through'))).toHaveLength(0)
    }
  })

test('in a forced palette a layer turned off still says so by its strike and its faint swatch', async ({
  page,
}, info) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await serve(page, LOWER)
  const days = await openDays(page, 1440)
  const keys = days.locator(`${LEGEND} [data-mark]`)
  const on = await keyBoxes(keys)
  await days.locator(OUTLINE_KEY).click()
  // The pointer leaves the key, so no underline of a hover stands beside the strike.
  await page.mouse.move(0, 0)
  const off = await keyBoxes(keys)
  await record(info, 'layer keys in a forced palette', { on, off })
  const turned = off.find(({ text }) => text === 'period before')
  expect(turned?.struck).toBe('line-through')
  expect(turned?.faint).toBeLessThan(1)
  expect(on.find(({ text }) => text === 'period before')).toMatchObject({
    struck: 'none',
    faint: 1,
  })
})
