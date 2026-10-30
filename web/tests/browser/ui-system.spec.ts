import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { expectNoSilentClipping } from './overflow.ts'

test.beforeEach(async ({ page }) => {
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
      body: JSON.stringify({
        interface_version: 'valkama-planning-work-item',
        scope: { kind: 'project', project_ref: { project_id: 'example-project' } },
        work_item_ref: {
          space_ref: { data_scope_id: '00000000-0000-4000-8000-000000000700', space_key: 'MAIN' },
          reference: 'MAIN-241',
        },
        state: {
          interface_version: 'valkama-ui-state',
          status: 'ready',
          payload: {
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
              description:
                'First loaded line\nSecond loaded line\nThird loaded line\nFourth loaded line\nFifth loaded line\nSixth loaded line',
              summary_comment_id: 1,
              summary: {
                done: 'First loaded line\nSecond loaded line\nThird loaded line\nFourth loaded line\nFifth loaded line\nSixth loaded line',
                next: 'Continue review',
                why: '',
              },
              links: [],
              refs: [],
              comments: [
                {
                  id: 1,
                  kind: 'report',
                  report: {
                    done: 'First loaded line\nSecond loaded line\nThird loaded line\nFourth loaded line\nFifth loaded line\nSixth loaded line',
                    next: 'Continue review',
                    why: '',
                  },
                  body: '',
                  author: 'user',
                  at: null,
                },
              ],
              events: [],
            },
          },
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
  await expect(icons).toHaveCount(2)
  for (let index = 0; index < 2; index += 1) {
    await expect(icons.nth(index)).toHaveCSS('width', '20px')
    await expect(icons.nth(index)).toHaveCSS('height', '20px')
  }
  // The count stands next to the label it belongs to. It used to be asserted
  // past the middle of the row, which is where a track pushed to the rail's far
  // edge put it: a two-word entry's own number an inch away from itself, and
  // six numbers in a right-hand column that means nothing read on its own.
  const sessionItem = page.locator('.module-planning')
  const labelBox = await sessionItem.locator('.nav-item-label').boundingBox()
  const badgeBox = await sessionItem.locator('.count-badge').boundingBox()
  expect(labelBox && badgeBox && badgeBox.x >= labelBox.x + labelBox.width).toBeTruthy()
  expect(labelBox && badgeBox && badgeBox.x - (labelBox.x + labelBox.width) <= 16).toBeTruthy()
  // Two groups: Work and Settings, which is a
  // destination too and stands under the last of them rather than in the
  // footer beside the connection state.
  await expect(page.locator('.nav-group')).toHaveCount(2)
  await expect(page.locator('.nav-utility .nav-item')).toHaveCount(0)
  // `.collapsed` was a class no template had rendered for some time, and the
  // rules that dressed it were dead in `shell.css` beside it. The rail narrows by
  // its own width now, so there is nothing left to assert the absence of.
  await expect(page.locator('.nav-item-count')).toHaveCount(1)
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
      await expect(page.locator('.context-activity')).toHaveCount(0)
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
  // A note is several lines, so the form is a column: the field takes the width
  // and the action stands at the start of its own row, on the control row height
  // every other button in the product occupies. It used to be one line beside a
  // button, and the shared baseline is what that geometry asserted.
  expect(formBox && fieldBox && Math.abs(fieldBox.width - formBox.width) < 1).toBeTruthy()
  expect(fieldBox && fieldBox.height >= 60 && fieldBox.height < 100).toBeTruthy()
  expect(submitBox && submitBox.height === 40).toBeTruthy()
  expect(formBox && submitBox && submitBox.width < formBox.width).toBeTruthy()
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

test('inspector textareas fit loaded and edited content and shrink after deletion or widening', async ({
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
  await expect.poll(height).toBeGreaterThan(140)
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
  await expect.poll(height).toBeLessThan(100)
  await expect(field).toHaveCSS('font-size', '15px')
  const shortHeight = await height()
  await field.fill('')
  await expect.poll(height).toBe(shortHeight)
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
  await expect(drawer.locator('.fact').first()).toBeVisible()
  const labelGap = await drawer
    .locator('.fact dt')
    .first()
    .evaluate((element) => {
      const next = element.nextElementSibling
      if (!next) throw new Error('Expected a value after the label')
      return next.getBoundingClientRect().top - element.getBoundingClientRect().bottom
    })
  expect(labelGap).toBe(8)
  const gaps = await drawer.evaluate((element) =>
    [
      ['.description-heading h3', '.description-copy'],
      ['.overview-section .section-line h3', '.section-line + .quiet'],
      ['.discussion > h3', '.discussion-feed'],
    ].map(([heading, content]) => {
      const title = element.querySelector(heading)
      const next = element.querySelector(content)
      if (!title || !next) throw new Error('Expected a heading and its visible content')
      return next.getBoundingClientRect().top - title.getBoundingClientRect().bottom
    }),
  )
  expect(gaps).toEqual([12, 12, 12])
  for (const selector of ['.description-copy', '.discussion .report-value']) {
    const content = drawer.locator(selector).filter({ visible: true }).first()
    await expect(content).toHaveCSS('font-size', '15px')
  }
  const labelHeights = await drawer
    .locator('.fact dt')
    .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
  expect(Math.max(...labelHeights) - Math.min(...labelHeights)).toBeLessThan(1)
})
