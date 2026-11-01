import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'

/**
 * The card's head reads as who the item is, what holds for it, and the one
 * thing to do. The facts used to start under a full-width write row and a
 * section, 476px down a desktop drawer, and the state was said twice: once as
 * a fact and once as a «Перевести в» select.
 */

const REFUSAL =
  '[summary] MAIN-264 has no closing summary; record what was done and what comes next before closing it'

async function openCard(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  const moves: unknown[] = []
  await page.route('**/api/planning/work-item/transition', async (route) => {
    moves.push(route.request().postDataJSON())
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'workflow_guard', message: REFUSAL } }),
    })
  })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  return { drawer, moves }
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('not laid out')
  return bounds
}

async function topOf(locator: Locator) {
  const bounds = await box(locator)
  return bounds.y
}

/** Below this drawer width the action stands under the labels at full width. */
const STACKED_BELOW = 520

for (const width of [1440, 1024, 390]) {
  test(`the head names the item, then its facts and one action, with nothing cut, at ${width}px`, async ({
    page,
  }) => {
    const { drawer } = await openCard(page, width)
    const head = drawer.locator('.drawer-frame-head')
    const top = await topOf(drawer)
    const stacked = width < STACKED_BELOW

    // Who it is, over the title; when it changed only where the line has room.
    const identity = head.locator('.card-identity')
    await expect(identity.locator('.head-reference')).toHaveText(workItemRef.reference)
    expect(await topOf(identity)).toBeLessThan(await topOf(head.locator('h2')))
    await expect(identity.locator('.identity-updated')).toBeVisible({ visible: !stacked })

    // The facts start high in the drawer and say the state once, as its menu.
    expect((await topOf(head.locator('.card-facts'))) - top).toBeLessThanOrEqual(180)
    await expect(drawer.getByText('Перевести в', { exact: true })).toHaveCount(0)
    await expect(
      head.getByRole('combobox', { name: 'Состояние: Dev. Перевести в другое' }),
    ).toHaveText('Dev')
    await expect(drawer.locator('.facts, .fact-term')).toHaveCount(0)

    // One action, and where it stands is the drawer's width to decide.
    const actions = head.locator('.write-actions button')
    await expect(actions).toHaveText(['Забрать себе'])
    const action = await box(actions)
    const facts = await box(head.locator('.card-facts'))
    const labels = await box(head.locator('.card-labels'))
    // Wide: at the end of the facts line, above the labels. Narrow: under the
    // labels, as wide as the facts.
    expect(action.y < labels.y).toBe(!stacked)
    expect(action.x >= facts.x + facts.width - 1).toBe(!stacked)
    expect(Math.abs(action.width - facts.width) < 1).toBe(stacked)

    // Labels are buttons that filter, each its own Tab stop.
    const chips = head.locator('.card-labels button')
    await expect(chips).toHaveCount(2)
    await expect(chips.first()).toHaveAttribute('aria-label', 'Фильтр: метка platform')

    // Updated and the source left the body; the path stands in Relations.
    await expect(drawer.locator('.drawer-frame-body').getByText('Обновлено')).toHaveCount(0)
    await expect(drawer.locator('.drawer-frame-body .source-anchor')).toHaveCount(0)
    await expect(head.locator('.identity-source')).toHaveAttribute(
      'aria-label',
      /docs\/plans\/platform\.md#kb:arch-plan$/u,
    )

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
    await expectNoSilentClipping(page, `card head at ${width}px`)
  })
}

test('the state chip moves the item from the keyboard and says why the server refused', async ({
  page,
}) => {
  const { drawer, moves } = await openCard(page, 1440)
  const chip = drawer.getByRole('combobox', { name: /^Состояние: Dev/u })
  await drawer.locator('.drawer-frame-close').focus()
  // Close, the reference, the source, then the state.
  for (let step = 0; step < 3; step += 1) await page.keyboard.press('Tab')
  await expect(chip).toBeFocused()

  await page.keyboard.press('Enter')
  const options = page.getByRole('option')
  await expect(options).toHaveText(['Dev', 'Done'])
  // Where the item is, checked and not a move.
  await expect(options.first()).toHaveAttribute('aria-disabled', 'true')
  // Escape closes the menu and leaves the card open.
  await page.keyboard.press('Escape')
  await expect(options).toHaveCount(0)
  await expect(drawer).toBeVisible()
  await expect(chip).toBeFocused()

  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect
    .poll(() => moves)
    .toEqual([{ author: 'user', id: workItemRef.reference, state: 'done' }])
  const refusal = drawer.locator('.drawer-frame-head .refusal')
  await expect(refusal).toContainText('Перевод в «Done» не выполнен')
  await expect(refusal).toContainText('has no closing summary')
  // The chip still names where the item is, and keeps the focus it had.
  await expect(chip).toHaveText('Dev')
  await expect(chip).toBeFocused()

  // The same move again by pointer is a second request, not a no-op.
  await chip.click()
  await page.getByRole('option', { name: 'Done' }).click()
  await expect.poll(() => moves.length).toBe(2)
})

test('a reference in a checklist step opens its card, and pressing the step text ticks it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page, { stepText: 'Wait for MAIN-265, then run `npm test`' })
  const ticks: unknown[] = []
  await page.route('**/api/planning/work-item/checklist/tick', async (route) => {
    ticks.push(route.request().postDataJSON())
    await route.abort()
  })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  const step = drawer.locator('.step-row').first()
  await expect(step.locator('.step-text code')).toHaveText('npm test')
  // The box is named by its text, markdown and all (a reference is a button
  // inside the label, which the browser reads with a space after it).
  await expect(
    drawer.getByRole('checkbox', { name: /^Wait for MAIN-265 ?, then run npm test$/u }),
  ).toBeVisible()

  // Pressing the text is pressing the box: a 28px box beside a sentence is not
  // the only target.
  await step.locator('.step-text').click({ position: { x: 4, y: 8 } })
  await expect.poll(() => ticks.length).toBe(1)

  // A reference in the text is a link of its own: it opens, and ticks nothing.
  await step.locator('.step-text').getByRole('button', { name: 'MAIN-265' }).click()
  await expect(drawer.locator('.head-reference')).toHaveText('MAIN-265')
  expect(ticks).toHaveLength(1)
})
