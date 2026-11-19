import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import { enableExecutionTab } from './executionFixtures.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { uiSystemCard, uiSystemHistory } from './served/uiSystem.ts'
import { test } from './test.ts'
import { heightOfLines } from './textLines.ts'

test.beforeEach(async ({ page }) => {
  await enableExecutionTab(page)
  await page.route('**/api/agent-sessions/**', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events: [] }),
    }),
  )
  // The inspector reads the exact project/store/item identity through the Kernel.
  await page.route('**/api/modules/planning/work-item?*', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(uiSystemCard()),
    }),
  )
  // The execution half of the same inspector. Left unanswered it reached the
  // dev proxy and the section rendered its failure, which is not the surface
  // the clipping and contrast checks below are meant to measure.
  await page.route('**/api/execution/history?*', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(uiSystemHistory()),
    }),
  )
})

test('grouped navigation keeps one optical icon box and corner badge without persisted collapse state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/tests/browser/harness.html?lang=ru')
  const rail = page.getByRole('navigation', { name: 'Разделы продукта', exact: true })
  // The harness's sections by the names the rail gives them, each a button whose name starts
  // with its title (Work's goes on with its count). A section added to the rail is one more
  // entry and fails none of this; one of these gone fails its own line.
  const entry = (title: string) =>
    rail.getByRole('button', { name: new RegExp(`^${title}(?:\\s|$)`, 'u') })
  const work = entry('Работа')
  for (const title of ['Работа', 'Аналитика', 'Настройки']) {
    await expect(entry(title), title).toHaveCount(1)
    const icon = entry(title).locator('.nav-item-icon')
    await expect(icon).toHaveCSS('width', '20px')
    await expect(icon).toHaveCSS('height', '20px')
  }
  // The count stands next to the label it belongs to. It used to be asserted
  // past the middle of the row, which is where a track pushed to the rail's far
  // edge put it: a two-word entry's own number an inch away from itself, and
  // six numbers in a right-hand column that means nothing read on its own.
  const labelBox = await work.locator('.nav-item-label').boundingBox()
  const badgeBox = await work.locator('.count-badge').boundingBox()
  expect(labelBox && badgeBox && badgeBox.x >= labelBox.x + labelBox.width).toBeTruthy()
  expect(labelBox && badgeBox && badgeBox.x - (labelBox.x + labelBox.width) <= 16).toBeTruthy()
  // The harness counts two for Work and nothing for the rest: the count Work shows is the
  // present control of the absence beside it.
  await expect(work.locator('.count-badge')).toHaveText('2')
  for (const title of ['Аналитика', 'Настройки'])
    await expect(entry(title).locator('.count-badge'), title).toHaveCount(0)
  // The groups by their headings: Work, and Understand with Analytics. The Work heading
  // repeats the name of its one entry: it stays for readers and takes no line.
  const echoedHeading = rail.getByRole('heading', { name: 'Работа', exact: true })
  await expect(echoedHeading).toHaveCount(1)
  const echoed = await echoedHeading.boundingBox()
  expect(echoed?.width ?? 2).toBeLessThanOrEqual(1)
  await expect(rail.getByRole('heading', { name: 'Анализ', exact: true })).toBeVisible()
  // Settings, which is a destination too, stands in the rail's foot beside the connection
  // state, so a long list does not move it: under every other entry.
  const settingsBox = await entry('Настройки').boundingBox()
  for (const title of ['Работа', 'Аналитика']) {
    const above = await entry(title).boundingBox()
    expect(above && settingsBox && settingsBox.y >= above.y + above.height, title).toBe(true)
  }
})

test('long Russian copy remains readable at narrow and 200 percent text layouts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 620, height: 900 })
  await page.goto('/tests/browser/harness.html?lang=ru')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(bodyWidth).toBeLessThanOrEqual(620)
  await expect(page.locator('.work-item-tile')).toBeVisible()
})

for (const locale of ['en', 'ru']) {
  for (const width of [1440, 1024, 760, 360]) {
    test(`context bar keeps ${locale} controls reachable without page overflow at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/tests/browser/harness.html?lang=${locale}&surface=context-bar`)
      await expect(page.locator('.context-bar')).toBeVisible()
      const geometry = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }))
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.client)
    })
  }
}

test('the note field spans its form and its action keeps a full pointer target', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.goto('/tests/browser/harness.html?lang=ru&surface=work-item')
  const drawer = page.locator('.drawer')
  await expect(drawer).toHaveCSS('transform', 'none')
  const workSurfaceBox = await page.locator('.harness-main').boundingBox()
  const drawerBox = await drawer.boundingBox()
  expect(drawerBox && drawerBox.x >= 0 && drawerBox.x + drawerBox.width <= 1181).toBeTruthy()
  expect(workSurfaceBox && workSurfaceBox.width >= 320).toBeTruthy()
  await expect(drawer).toHaveAttribute('role', 'dialog')
  await expect(drawer.locator('.drawer-frame-body')).toHaveCount(1)
  await expect(drawer.locator('.drawer-frame-body')).toHaveCSS('overflow-y', 'auto')
  const field = drawer.locator('.discussion-form textarea')
  const submit = drawer.locator('.discussion-form button[type="submit"]')
  const formBox = await drawer.locator('.discussion-form').boundingBox()
  const fieldBox = await field.boundingBox()
  const submitBox = await submit.boundingBox()
  const fiveLines = await heightOfLines(field, 5)
  const control = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--size-control-height'),
    ),
  )
  // A note is several lines, so the form is a column inside one frame: the text
  // takes the width and five lines of height, and the action stands at the end of
  // the frame's foot, on the control row height every other button occupies.
  expect(formBox && fieldBox && Math.abs(fieldBox.width - (formBox.width - 2)) < 1).toBeTruthy()
  expect(fieldBox && fieldBox.height === fiveLines).toBeTruthy()
  expect(submitBox && submitBox.height === control).toBeTruthy()
  expect(fieldBox && submitBox && submitBox.y >= fieldBox.y + fieldBox.height).toBeTruthy()
  expect(formBox && submitBox && submitBox.width < formBox.width).toBeTruthy()
  expect(
    formBox && submitBox && formBox.x + formBox.width - (submitBox.x + submitBox.width) <= 6,
  ).toBeTruthy()
})

test('a command dialog layers over its inspector and Escape closes only the active choice', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/tests/browser/harness.html?lang=en')
  await page.getByRole('button', { name: 'Открыть тестовую панель' }).click()
  const drawer = page.locator('.overlay-layer-drawer')
  await expect(drawer.getByRole('dialog', { name: 'Тестовая панель' })).toBeVisible()
  await drawer.getByRole('button', { name: 'Открыть команду' }).click()
  await expect(drawer.locator('.overlay-surface')).toHaveAttribute('aria-hidden', 'true')
  const command = page.getByRole('dialog', { name: 'Настройка команды' })
  await expect(command).toBeVisible()
  const choice = command.getByRole('combobox', { name: 'Среда запуска' })
  await choice.click()
  const search = page.getByRole('searchbox', { name: 'Найти среду' })
  await search.fill('Claude')
  await expect(page.getByRole('option', { name: /Claude Code/ })).toBeVisible()
  await search.press('Escape')
  await expect(command).toBeVisible()
  await expect(page.locator('.choice-popup')).toHaveCount(0)
  await expect(choice).toBeFocused()
  await command.getByRole('button', { name: 'Закрыть настройку команды' }).click()
  await expect(command).toHaveCount(0)
  await expect(drawer.getByRole('dialog', { name: 'Тестовая панель' })).toBeVisible()
})

test('custom selection portals and flips without moving page content', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 520 })
  await page.goto('/tests/browser/harness.html?lang=ru')
  const initialScrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
  await page.getByRole('combobox', { name: 'Граничный выбор среды' }).click()
  const popup = page.locator('.choice-popup')
  await expect(popup).toBeVisible()
  const box = await popup.boundingBox()
  expect(
    box && box.x >= 8 && box.y >= 8 && box.x + box.width <= 752 && box.y + box.height <= 512,
  ).toBeTruthy()
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(initialScrollHeight)
})

// A tile's labels used to be buttons that searched by the label they showed, and
// this case held that row to a small visual height with a full pointer target.
// The search surface went in the cutover and took the affordance with it, so the
// labels are text: there is nothing here to point at any more. The case comes
// back with the search screen, not before.

/**
 * The static rules read the template; axe reads what the browser built from it,
 * which is where contrast, computed roles and generated ids live. The harness
 * is the surface to point it at because it renders the shared primitives with
 * no server behind them.
 */
for (const surface of ['', 'work-item', 'context-bar']) {
  const query = surface ? `&surface=${surface}` : ''

  test(`the ${surface || 'default'} harness surface has no serious axe violations`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/harness.html?lang=ru${query}`)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    )
    expect(
      blocking.map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
      ),
    ).toEqual([])
  })
}

/**
 * The harness renders the tile at the width a board column gives it, with the
 * labels and counts a real item carries — which is the one place in this suite
 * where the tile is under the pressure that keeps producing this defect. The
 * production fixtures are tamer than the operator's own space, and that is
 * exactly why the clipping there was found by eye three reviews running.
 */
for (const surface of ['', 'work-item']) {
  const query = surface ? `&surface=${surface}` : ''

  test(`the ${surface || 'default'} harness surface clips nothing silently`, async ({ page }) => {
    await page.goto(`/tests/browser/harness.html?lang=ru${query}`)
    await expect(page.locator('.harness-card-list .work-item-tile')).toBeVisible()
    await expectNoSilentClipping(page, `${surface || 'default'} harness`)
  })
}

test('inspector textareas fit their content from the lines they ask for up to a ceiling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/tests/browser/harness.html?lang=en&surface=work-item')
  const drawer = page.locator('.drawer')
  await drawer.getByRole('button', { name: 'Edit description', exact: true }).click()
  const field = drawer.getByRole('textbox', { name: 'Description', exact: true })
  await expect(field).toHaveValue(/Sixth loaded line$/)
  const height = () => field.evaluate((element) => element.getBoundingClientRect().height)
  const fits = () => field.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)
  // Six lines loaded in a field that asks for six: the floor and the text agree.
  const floor = await heightOfLines(field, 6)
  await expect.poll(height).toBe(floor)
  await expect.poll(fits).toBe(true)
  const loadedHeight = await height()
  await field.fill('Edited line 0')
  for (let index = 1; index < 16; index += 1) {
    await field.press('End')
    await field.press('Enter')
    await field.pressSequentially(`Edited line ${index}`)
  }
  await expect.poll(height).toBeGreaterThan(loadedHeight)
  await expect.poll(fits).toBe(true)
  await field.fill('Short')
  await expect.poll(height).toBe(floor)
  await expect(field).toHaveCSS('font-size', '15px')
  await field.fill('')
  await expect.poll(height).toBe(floor)
  // Past the ceiling, 60% of this window, the text scrolls inside and the box stops: the
  // token's `min(30lh, 60dvh)`, where thirty lines would be taller.
  expect(await heightOfLines(field, 30)).toBeGreaterThan(600)
  await field.fill(Array.from({ length: 60 }, (_, index) => `Line ${index}`).join('\n'))
  await expect.poll(height).toBe(600)
  await expect.poll(fits).toBe(false)
  const splitter = drawer.getByRole('separator')
  await splitter.press('End')
  await field.fill(
    'A readable paragraph must wrap naturally as the inspector width changes. '.repeat(8),
  )
  const wideHeight = await height()
  await splitter.press('Home')
  await expect.poll(height).toBeGreaterThan(wideHeight)
  await expect.poll(fits).toBe(true)
  await splitter.press('End')
  await expect.poll(height).toBe(wideHeight)
})

test('inspector facts and section headings keep a shared spacing rhythm', async ({ page }) => {
  await page.goto('/tests/browser/harness.html?lang=en&surface=work-item')
  const drawer = page.locator('.drawer')
  // Each fact is named beside its value, not over it: the name stands on the words of the
  // value's chip, so the two share a line to within a pixel and a half, and what shares the
  // value's line shares its centre.
  await expect(drawer.locator('.card-facts').first()).toBeVisible()
  // The first fact's row: its name, and what of the values stands across the name's line.
  const { name, values } = await drawer
    .locator('.card-facts')
    .first()
    .evaluate((facts) => {
      const line = facts.querySelector('.card-row-label')?.getBoundingClientRect()
      const across = [...facts.querySelectorAll('.card-row-value > *')]
        .map((element) => element.getBoundingClientRect())
        .filter((box) => line !== undefined && box.top < line.bottom && box.bottom > line.top)
      return {
        name: line ? line.top + line.height / 2 : Number.NaN,
        values: across.map((box) => box.top + box.height / 2),
      }
    })
  const firstRow = [name, ...values]
  expect(name).not.toBeNaN()
  expect(values.length).toBeGreaterThan(0)
  expect(Math.max(...firstRow) - Math.min(...firstRow)).toBeLessThan(1.5)
  expect(Math.max(...values) - Math.min(...values)).toBeLessThan(1)
  const gaps = await drawer.evaluate((element) =>
    [
      ['.description-heading h3', '.description-copy'],
      ['.discussion .section-header h3', '.thread-filter'],
    ].map(([heading, content]) => {
      const title = element.querySelector(heading)
      const next = element.querySelector(content)
      if (!title || !next) throw new Error('Expected a heading and its visible content')
      return next.getBoundingClientRect().top - title.getBoundingClientRect().bottom
    }),
  )
  expect(gaps).toEqual([12, 12])
  for (const selector of ['.description-copy', '.discussion .report-value']) {
    const content = drawer.locator(selector).filter({ visible: true }).first()
    await expect(content).toHaveCSS('font-size', '15px')
  }
})
