import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { expectNoSilentClipping } from './overflow.ts'

const centerX = (box: { width: number; x: number }) => box.x + box.width / 2

test.beforeEach(async ({ page }) => {
  await page.route('**/api/agent-sessions/**', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ events: [] }),
    }),
  )
  // Planning's own route: the inspector reads the record, and the Kernel half
  // arrives as a prop from the surface above it.
  await page.route('**/api/planning/work-item?*', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        interface_version: 'valkama-planning-api',
        work_item: {
          work_item_id: '00000000-0000-4000-8000-000000000241',
          planning_space_id: '00000000-0000-4000-8000-000000000800',
          reference: 'MAIN-241',
          number: 241,
          title: 'System interface contract',
          kind: 'task',
          state: {
            state_id: '00000000-0000-4000-8000-000000000901',
            key: 'review',
            name: 'Review',
            category: 'review',
            is_terminal: false,
          },
          priority: 'high',
          claim_ref: 'codex',
          parent_id: null,
          labels: [],
          source: '',
          container: false,
          ready: false,
          checklist: [],
          revision: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          description: 'A deterministic inspector fixture.',
          summary: null,
          links: [],
          refs: [],
          comments: [],
          events: [],
        },
      }),
    }),
  )
  // The execution half of the same inspector. Left unanswered it reached the
  // dev proxy and the section rendered its failure, which is not the surface
  // the clipping and contrast checks below are meant to measure.
  await page.route('**/api/execution/history?*', async (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        interface_version: 'valkama-execution-api',
        work_item: 'MAIN-241',
        executions: [
          {
            execution_id: 'exec-1a2b3c4d5e6f708192a3b4c5d6e7f809',
            work_item_id: '00000000-0000-4000-8000-000000000241',
            project_id: 'example-project',
            adapter_lineage_id: 'claude-code-execution',
            client_family: 'claude',
            role: 'executor',
            environment: 'workdir',
            model: 'opus',
            effort: 'high',
            expected_effect: 'change_required',
            review_mode: '',
            status: 'partial',
            presence: 'terminal',
            outcome: 'partial',
            launch_id: 'launch-0123456789ab',
            cwd: 'C:/workspace/example-project',
            resumed_from: '',
            exit_code: 0,
            result: {
              outcome: 'partial',
              delivery: 'Половина контракта готова, вторая осталась без оракула.',
              oracle: 'suite green',
              unresolved: 'Оракул приёмки не выполнялся.',
              structured: true,
              expected_effect: 'change_required',
            },
            base_artifact: null,
            final_artifact: {
              head: '3333333333333333333333333333333333333333',
              branch: 'main',
              dirty: true,
              changed_files: 2,
              insertions: 18,
              deletions: 4,
              commits: [],
              quality: 'observed',
            },
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            revision: 2,
            sessions: [],
          },
        ],
      }),
    }),
  )
})

test('grouped navigation keeps one optical icon box and corner badge without persisted collapse state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/tests/browser/harness.html?lang=ru')
  const icons = page.locator('.nav-item .nav-item-icon')
  await expect(icons).toHaveCount(7)
  for (let index = 0; index < 7; index += 1) {
    await expect(icons.nth(index)).toHaveCSS('width', '20px')
    await expect(icons.nth(index)).toHaveCSS('height', '20px')
  }
  // The count stands next to the label it belongs to. It used to be asserted
  // past the middle of the row, which is where a track pushed to the rail's far
  // edge put it: a two-word entry's own number an inch away from itself, and
  // six numbers in a right-hand column that means nothing read on its own.
  const sessionItem = page.locator('.module-sessions')
  const labelBox = await sessionItem.locator('.nav-item-label').boundingBox()
  const badgeBox = await sessionItem.locator('.count-badge').boundingBox()
  expect(labelBox && badgeBox && badgeBox.x >= labelBox.x + labelBox.width).toBeTruthy()
  expect(labelBox && badgeBox && badgeBox.x - (labelBox.x + labelBox.width) <= 16).toBeTruthy()
  // Four groups: the three destination groups and Settings, which is a
  // destination too and stands under the last of them rather than in the
  // footer beside the connection state.
  await expect(page.locator('.nav-group')).toHaveCount(4)
  await expect(page.locator('.nav-utility .nav-item')).toHaveCount(0)
  // `.collapsed` was a class no template had rendered for some time, and the
  // rules that dressed it were dead in `shell.css` beside it. The rail narrows by
  // its own width now, so there is nothing left to assert the absence of.
  await expect(page.locator('.nav-item-count')).toHaveCount(1)
})

test('session ledger uses a bounded readable measure and opens the row itself', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1840, height: 920 })
  await page.goto('/tests/browser/harness.html?lang=ru')
  const ledger = page.locator('.session-ledger')
  const list = page.locator('.session-table-wrap').first()
  const ledgerBox = await ledger.boundingBox()
  const listBox = await list.boundingBox()
  // The bound is the column every module shares, read from the palette rather
  // than repeated here. It used to be 1180 — one of four widths the product
  // had for the same idea, which is why the text started somewhere new in each
  // module — and a number in this file was one of the four.
  const column = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--size-module-column'),
    ),
  )
  expect(column).toBeGreaterThan(0)
  expect(ledgerBox && listBox && listBox.width <= column).toBeTruthy()
  expect(
    ledgerBox &&
      listBox &&
      Math.abs(listBox.x - ledgerBox.x - (ledgerBox.width - listBox.width) / 2) < 3,
  ).toBeTruthy()
  await expect(page.locator('td.client-cell').first()).toHaveCSS('display', 'table-cell')
  await page.locator('.session-open').first().click()
  await expect(page.locator('.resizable-inspector')).toBeVisible()
  await expect(page.locator('.inspector-frame > header')).toBeVisible()
  // The filter is named the way it is rendered — label first, count after the
  // separator. This read `/0.*работают/` from before the sessions filters
  // became a segmented control, and had been unmatchable ever since.
  const workingFilter = page.getByRole('button', { name: /работают · 0/i })
  const filterBox = await workingFilter.boundingBox()
  const track = await page.locator('.segmented').first().boundingBox()
  // A segment fills its track less the track's own inset, and the track is the
  // row every control in the toolbar stands in. This read 44 — the pointer
  // target — as if it were the drawing, which is the conflation that made the
  // track 48px tall beside a 44px button. What a segment owes is the WCAG 2.5.8
  // minimum of 24px, and the row it belongs to is what makes the toolbar line
  // up.
  expect(filterBox?.height).toBeGreaterThanOrEqual(24)
  const row = await page.evaluate(() =>
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--size-control-height'),
    ),
  )
  expect(track?.height).toBe(row)
  expect(filterBox && track && track.height - filterBox.height).toBe(4)
  await workingFilter.click()
  await expect(workingFilter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.session-group')).toHaveCount(1)
  const filterEmpty = page.locator('.filter-empty')
  await expect(filterEmpty).toContainText('нет сессий')
  // One sentence, said once: the empty status used to add a generic headline
  // over the reason, so the same absence was announced twice in two voices.
  await expect(filterEmpty.locator('.empty-title')).toHaveCount(1)
  await expect(filterEmpty.locator('.platform-state-title')).toHaveCount(0)
  // And said in the middle of the space the rows would occupy. The old band
  // put the icon at the left wall, the headline at the table's center and the
  // reason inside a left-anchored measure — three pieces in three places.
  const wrapBox = await page.locator('.session-table-wrap').first().boundingBox()
  const messageBox = await filterEmpty.locator('.empty-title').boundingBox()
  const markBox = await filterEmpty.locator('.empty-mark').boundingBox()
  expect(wrapBox && messageBox && Math.abs(centerX(messageBox) - centerX(wrapBox)) < 3).toBeTruthy()
  expect(markBox && messageBox && Math.abs(centerX(markBox) - centerX(messageBox)) < 3).toBeTruthy()
  expect(markBox && messageBox && markBox.y + markBox.height <= messageBox.y + 1).toBeTruthy()
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
  await expect(page.locator('td.client-cell').first()).toHaveCSS('display', 'block')
  await expect(page.locator('.session-open').first()).toBeVisible()
})

for (const locale of ['en', 'ru']) {
  for (const width of [1440, 1024, 760, 360]) {
    test(`context bar keeps ${locale} controls reachable without page overflow at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/tests/browser/harness.html?lang=${locale}&surface=context-bar`)
      await expect(page.locator('.context-bar')).toBeVisible()
      await expect(page.locator('.context-activity')).toBeVisible()
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
  const workspaceBox = await page.locator('.harness-main').boundingBox()
  const workSurfaceBox = await page.locator('.monitor').boundingBox()
  const drawerBox = await drawer.boundingBox()
  expect(
    workspaceBox &&
      drawerBox &&
      drawerBox.x >= workspaceBox.x &&
      drawerBox.x + drawerBox.width <= workspaceBox.x + workspaceBox.width + 1,
  ).toBeTruthy()
  expect(workSurfaceBox && workSurfaceBox.width >= 320).toBeTruthy()
  await expect(drawer).not.toHaveAttribute('role', 'dialog')
  await expect(drawer.locator('.drawer-frame-body')).toHaveCount(1)
  await expect(drawer.locator('.drawer-frame-body')).toHaveCSS('overflow-y', 'auto')
  // The sections are the shared segmented control, so a section is a button.
  await drawer.getByRole('button', { name: /история/i }).click()
  const field = drawer.locator('.note-form textarea')
  const submit = drawer.locator('.note-form button[type="submit"]')
  const formBox = await drawer.locator('.note-form').boundingBox()
  const fieldBox = await field.boundingBox()
  const submitBox = await submit.boundingBox()
  // A note is several lines, so the form is a column: the field takes the width
  // and the action stands at the start of its own row, on the control row height
  // every other button in the product occupies. It used to be one line beside a
  // button, and the shared baseline is what that geometry asserted.
  expect(formBox && fieldBox && Math.abs(fieldBox.width - formBox.width) < 1).toBeTruthy()
  expect(fieldBox && fieldBox.height > 44).toBeTruthy()
  expect(submitBox && submitBox.height === 40).toBeTruthy()
  expect(formBox && submitBox && submitBox.width < formBox.width).toBeTruthy()
})

test('Sessions to Analytics navigation is free of page and console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/tests/browser/harness.html?lang=ru')
  await page.getByRole('button', { name: /аналитика/i }).click()
  await expect(page.locator('.analytics-dashboard')).toBeVisible()
  expect(errors).toEqual([])
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

test('analytics data opens in a URL-owned drawer without reflowing the chart', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/tests/browser/harness.html?lang=ru&surface=analytics')
  const chart = page.locator('.throughput-card .echarts-chart')
  const before = await chart.boundingBox()
  await page.locator('.throughput-card .data-inspector-trigger').click()
  await expect(page).toHaveURL(/analyticsTable=throughput/)
  await expect(page.locator('.analytics-table-drawer')).toBeVisible()
  const drawerBox = await page.locator('.analytics-table-drawer').boundingBox()
  expect(drawerBox?.width).toBeGreaterThanOrEqual(800)
  const tableOverflow = await page
    .locator('.analytics-table-scroll')
    .evaluate((element) => getComputedStyle(element).overflowX)
  expect(tableOverflow).toBe('auto')
  await expect(chart).toBeVisible()
  const after = await chart.boundingBox()
  expect(after && before && { width: after.width, height: after.height }).toEqual({
    width: before?.width,
    height: before?.height,
  })
  await page.locator('.analytics-table-drawer').getByRole('button', { name: 'Закрыть' }).click()
  await expect(page).not.toHaveURL(/analyticsTable=/)
})

test('the attempt totals open the rows behind them, each with its own provenance', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/tests/browser/harness.html?lang=ru&surface=analytics')
  await page.locator('.execution-analytics .data-inspector-trigger').click()
  await expect(page).toHaveURL(/analyticsTable=executions/)

  const drawer = page.locator('.analytics-table-drawer')
  await expect(drawer).toBeVisible()
  const rows = drawer.locator('tbody tr')
  await expect(rows).toHaveCount(2)

  // The observed attempt names who answered and the session to go and read.
  await expect(rows.first()).toContainText('MAIN-1')
  await expect(rows.first()).toContainText('claude-journal-telemetry')
  await expect(rows.first()).toContainText('sess-claude-1')

  // The unobserved one says so in its own row rather than borrowing the
  // block's coverage line, which is the question a reader opens this to ask.
  await expect(rows.nth(1)).toContainText('MAIN-2')
  await expect(rows.nth(1)).not.toContainText('claude-journal-telemetry')

  await drawer.getByRole('button', { name: 'Закрыть' }).click()
  await expect(page).not.toHaveURL(/analyticsTable=/)
})

/**
 * The static rules read the template; axe reads what the browser built from it,
 * which is where contrast, computed roles and generated ids live. The harness
 * is the surface to point it at because it renders the shared primitives with
 * no server behind them.
 *
 * One known violation is allowed through by name. The KPI ledger puts a `small`
 * note beside `dt` and `dd` inside a `dl > div`, which may hold only those two;
 * moving it is a layout change rather than an attribute swap, so card #305 owns
 * it. Naming the rule keeps every other violation failing, including a second
 * instance of this one somewhere new.
 */
const KNOWN_VIOLATIONS = new Set(['definition-list'])
for (const surface of ['', 'card', 'analytics']) {
  const query = surface ? `&surface=${surface}` : ''

  test(`the ${surface || 'default'} harness surface has no serious axe violations`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/harness.html?lang=ru${query}`)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const blocking = results.violations.filter(
      (violation) =>
        (violation.impact === 'critical' || violation.impact === 'serious') &&
        !KNOWN_VIOLATIONS.has(violation.id),
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
