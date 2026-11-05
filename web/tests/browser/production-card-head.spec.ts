import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

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
    const lead = drawer.locator('.drawer-frame-lead')
    const top = await topOf(drawer)
    const stacked = width < STACKED_BELOW

    // Who it is, over the title; when it changed only where the line has room.
    const identity = drawer.locator('.card-identity')
    await expect(identity.locator('.head-reference')).toHaveText(workItemRef.reference)
    expect(await topOf(identity)).toBeLessThan(await topOf(lead.locator('h2')))
    await expect(identity.locator('.identity-updated')).toBeVisible({ visible: !stacked })

    // The facts start high in the drawer and say the state once, as its menu.
    expect((await topOf(lead.locator('.card-facts'))) - top).toBeLessThanOrEqual(180)
    await expect(drawer.getByText('Перевести в', { exact: true })).toHaveCount(0)
    await expect(
      lead.getByRole('combobox', { name: 'Состояние: Dev. Перевести в другое' }),
    ).toHaveText('Dev')
    await expect(drawer.locator('.facts, .fact-term')).toHaveCount(0)

    // One action, and where it stands is the drawer's width to decide.
    const actions = lead.locator('.write-actions button')
    await expect(actions).toHaveText(['Забрать себе'])
    const action = await box(actions)
    const facts = await box(lead.locator('.card-facts'))
    const labels = await box(lead.locator('.card-labels'))
    // Wide: at the end of the facts' first row, above the labels, its top and height
    // the row's. Narrow: under the labels, as wide as the facts.
    expect(action.y < labels.y).toBe(!stacked)
    expect(action.x >= facts.x + facts.width - 1).toBe(!stacked)
    expect(Math.abs(action.width - facts.width) < 1).toBe(stacked)
    expect(Math.abs(action.y - facts.y) < 1).toBe(!stacked)
    expect(action.height).toBe(36)

    // Labels are buttons that filter, each its own Tab stop.
    const chips = lead.locator('.card-labels button')
    await expect(chips).toHaveCount(2)
    await expect(chips.first()).toHaveAttribute('aria-label', 'Фильтр: метка platform')

    // Updated and the source left the body; the path stands in Relations.
    await expect(drawer.locator('.drawer-frame-content').getByText('Обновлено')).toHaveCount(0)
    await expect(drawer.locator('.drawer-frame-content .ref-row')).toHaveCount(0)
    await expect(drawer.locator('.identity-source')).toHaveAttribute(
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
  // Close, the reference, its link, the source, then the state.
  for (let step = 0; step < 4; step += 1) await page.keyboard.press('Tab')
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
  const refusal = drawer.locator('.drawer-frame-notices .refusal')
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
  await step.locator('.step-text').getByRole('link', { name: 'MAIN-265' }).click()
  await expect(drawer.locator('.head-reference')).toHaveText('MAIN-265')
  expect(ticks).toHaveLength(1)
})

/**
 * What stays pinned of a card read down is the bar and one row of sections: no taller
 * than the head 2.1.0 pinned, which held the title and the sections. The 2.2 head kept
 * the facts, a full-width action on a phone and two rows of sections, and pinned 279px
 * of an 844px phone.
 */
const PINNED_AT_MOST: Readonly<Record<number, number>> = { 1440: 141, 1024: 141, 390: 175 }

async function openLongCard(page: Page, width: number, answer?: (page: Page) => Promise<unknown>) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await enableExecutionTab(page)
  await page.setViewportSize({ width, height: 844 })
  await installBackend(page, { longRead: true })
  // A route added after the backend's answers before it.
  await answer?.(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  // The drawer has stopped sliding in, so that places read below are its own.
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

const toEnd = (drawer: Locator) =>
  drawer.locator('.drawer-frame-body').evaluate((node) => node.scrollTo({ top: node.scrollHeight }))

/** Whether anything still fades: the bar's answers are read when they have landed. */
const settled = (drawer: Locator) =>
  expect
    .poll(() =>
      drawer
        .locator('.drawer-frame-bar')
        .evaluate((bar) => bar.getAnimations({ subtree: true }).length),
    )
    .toBe(0)

for (const width of [1440, 1024, 390]) {
  test(`a card read down keeps its title, its action and one row of sections at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openLongCard(page, width)
    const bar = drawer.locator('.drawer-frame-bar')
    const pinnedAction = bar.locator('.drawer-frame-action').getByRole('button')
    await expect(pinnedAction).toBeHidden()
    await toEnd(drawer)
    await settled(drawer)

    const tabsBox = await box(drawer.locator('.drawer-frame-tabs'))
    const barBox = await box(bar)
    expect(tabsBox.y).toBeCloseTo(barBox.y + barBox.height, 0)
    expect(barBox.height + tabsBox.height).toBeLessThanOrEqual(PINNED_AT_MOST[width] ?? 0)

    // Which item this is: its title, on one line, in place of the identity.
    const title = bar.locator('.drawer-frame-pinned-title')
    await expect(title).toBeVisible()
    await expect(bar.locator('.card-identity')).toBeHidden()
    const line = await title.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).lineHeight),
    )
    const titleBox = await box(title)
    expect(titleBox.height).toBeLessThanOrEqual(line + 1)
    // The one action, in reach, and Close beside it.
    await expect(pinnedAction).toBeVisible()
    await expect(pinnedAction).toHaveText('Забрать себе')
    await expect(drawer.locator('.card-facts')).not.toBeInViewport()

    // The sections keep one row, and each one the arrows reach is brought into view.
    const tabs = drawer.locator('.inspector-tabs').getByRole('tab')
    const tops = await tabs.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
    )
    expect(new Set(tops).size).toBe(1)
    await tabs.first().focus()
    const count = await tabs.count()
    for (let index = 1; index < count; index += 1) {
      await page.keyboard.press('ArrowRight')
      await expect(tabs.nth(index)).toBeFocused()
      await expect(tabs.nth(index)).toBeInViewport({ ratio: 0.99 })
    }
  })
}

for (const width of [1440, 390]) {
  test(`a long text's toggle starts where the text starts at ${width}px`, async ({ page }) => {
    const drawer = await openLongCard(page, width)
    const description = drawer.locator('.description-copy')
    const toggle = description.locator('.collapsible-toggle')
    await expect(toggle).toBeVisible()
    // Read in one frame: the drawer may still be sliding in. The toggle is bare at rest, so
    // what has to line up is its words, not the fill it takes under the pointer.
    const offset = await description.evaluate((node) => {
      const toggle = node.querySelector('.collapsible-toggle')
      const range = document.createRange()
      if (toggle) range.selectNodeContents(toggle)
      const words = [...range.getClientRects()].find((rect) => rect.width > 0)
      const text = node.querySelector('.collapsible-text')?.getBoundingClientRect().left
      return (words?.left ?? Number.NaN) - (text ?? Number.NaN)
    })
    expect(offset).toBeCloseTo(0, 0)
  })
}

/**
 * Where the head would give a reason in place of the action — an epic, an item
 * waiting on a blocker — the reason is a fact and goes with the facts: the bar has
 * nothing to press, and the title keeps its room.
 */
test('a read-down epic has no action in its bar and its reason goes with the facts', async ({
  page,
}) => {
  const epic = {
    ...workItem,
    container: true,
    claim: null,
    claim_ref: '',
    description: Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}.`).join(
      String.fromCodePoint(10, 10),
    ),
  }
  const drawer = await openLongCard(page, 390, (opened) =>
    opened.route('**/api/modules/planning/work-item?*', (route) =>
      route.fulfill({
        json: {
          interface_version: 'valkama-planning-work-item',
          scope: projectScope,
          work_item_ref: workItemRef,
          state: {
            interface_version: 'valkama-ui-state',
            status: 'ready',
            payload: { work_item: epic },
          },
        },
      }),
    ),
  )
  const reason = drawer.locator('.card-action')
  await expect(reason).toContainText('Эпик')
  await toEnd(drawer)
  await settled(drawer)
  await expect(reason).not.toBeInViewport()
  await expect(drawer.locator('.drawer-frame-action').getByRole('button')).toHaveCount(0)
  await expect(drawer.locator('.drawer-frame-action')).toHaveText('')
  // The title takes what the empty cell leaves: most of the row up to Close.
  const reach = await drawer.locator('.drawer-frame-bar').evaluate((bar) => {
    const edge = (selector: string) => bar.querySelector(selector)?.getBoundingClientRect()
    return (
      (edge('.drawer-frame-close')?.left ?? 0) - (edge('.drawer-frame-pinned-title')?.right ?? 0)
    )
  })
  expect(reach).toBeLessThanOrEqual(16 + 1)
})

/**
 * A takeover is asked once wherever its button was pressed, in the band under the bar
 * that stays in view: the bar has no room for a sentence, and the facts may be out of
 * sight. The question takes the band's width, and what stands around it stays put.
 */
for (const width of [1440, 390]) {
  test(`a takeover asked from a read-down card keeps its title and sections at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openLongCard(page, width)
    await toEnd(drawer)
    await settled(drawer)
    const bar = drawer.locator('.drawer-frame-bar')
    const barBefore = await box(bar)
    await bar.getByRole('button', { name: 'Забрать себе' }).click()
    const notices = drawer.locator('.drawer-frame-notices')
    await expect(notices.getByRole('button', { name: 'Забрать', exact: true })).toBeVisible()
    expect(await box(bar)).toEqual(barBefore)
    const widths = await drawer.evaluate((node) => {
      const measure = (selector: string) =>
        node.querySelector(selector)?.getBoundingClientRect().width ?? 0
      return {
        drawer: node.getBoundingClientRect().width,
        title: measure('.drawer-frame-pinned-title'),
        tabs: measure('.inspector-tabs'),
        question: measure('.drawer-frame-notices .confirm-strip'),
      }
    })
    // The question and the sections take the drawer's width less its insets.
    expect(widths.question).toBeGreaterThanOrEqual(widths.drawer - 48 - 1)
    expect(widths.tabs).toBeGreaterThanOrEqual(widths.drawer - 48 - 12)
    expect(widths.title).toBeGreaterThan(0)
    await notices.getByRole('button', { name: 'Отмена' }).click()
    await expect(notices).toHaveCount(0)
    await expect(bar.getByRole('button', { name: 'Забрать себе' })).toBeVisible()
  })
}

test('a takeover pressed among the facts asks in the same place, and goes through', async ({
  page,
}) => {
  const drawer = await openLongCard(page, 1440)
  const claims: unknown[] = []
  await page.route('**/api/planning/work-item/claim', async (route) => {
    claims.push(route.request().postDataJSON())
    await route.abort()
  })
  await drawer.locator('.card-action').getByRole('button', { name: 'Забрать себе' }).click()
  const notices = drawer.locator('.drawer-frame-notices')
  await expect(notices.locator('.confirm-strip')).toBeVisible()
  expect(claims).toHaveLength(0)
  await notices.getByRole('button', { name: 'Забрать', exact: true }).click()
  await expect.poll(() => claims.length).toBe(1)
  await expect(notices.locator('.confirm-strip')).toHaveCount(0)
})

for (const width of [1440, 390]) {
  test(`a fact the item does not have takes no place among the facts at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openLongCard(page, width)
    // This item stands in no epic. An empty cell still takes a gap, and where the row is
    // full it wraps to a row of its own, which reads as a blank line under the facts. The
    // state and priority stand beside the action, the holder on the line under them.
    const widths = await drawer
      .locator('.card-facts > *, .card-held-line > *')
      .evaluateAll((facts) => facts.map((fact) => fact.getBoundingClientRect().width))
    expect(widths).toHaveLength(3)
    expect(Math.min(...widths)).toBeGreaterThan(0)
  })
}

/** The type a line is set in, read as the browser resolved it. */
const typeOf = (target: Locator) =>
  target.evaluate((node) => {
    const style = getComputedStyle(node)
    return { size: Number.parseFloat(style.fontSize), weight: style.fontWeight, font: style.font }
  })

test('what comes next reads as the text under a heading, no larger than the heading', async ({
  page,
}) => {
  const drawer = await openLongCard(page, 1440)
  const next = drawer.locator('.overview-section').filter({ hasText: 'Что дальше' })
  const heading = await typeOf(next.getByRole('heading', { name: 'Что дальше' }))
  const step = await typeOf(next.locator('p'))
  const description = await typeOf(drawer.locator('.description-copy .collapsible-text'))
  // The step's words stood at the page's 16px, over a 15px heading.
  expect(step.size).toBeLessThanOrEqual(heading.size)
  expect(step.weight).not.toBe(heading.weight)
  expect(step.font).toBe(description.font)
})
