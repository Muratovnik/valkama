import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItem, workItemRef } from './planningFixtures.ts'

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

/**
 * Read down a long card and the part of the head that stays is the item's
 * title on one line, its one action and the sections on one row: no taller
 * than the head 2.1.0 pinned, which held the title and the sections. The 2.2
 * head kept the facts, a full-width action on a phone and two rows of
 * sections, and pinned 279px of an 844px phone.
 */
const PINNED_AT_MOST: Readonly<Record<number, number>> = { 1440: 141, 1024: 141, 390: 175 }

async function openLongCard(page: Page, width: number, answer?: (page: Page) => Promise<unknown>) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
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
  return drawer
}

for (const width of [1440, 1024, 390]) {
  test(`a card read down keeps its title, its action and one row of sections at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openLongCard(page, width)
    const head = drawer.locator('.drawer-frame-head')
    const action = drawer.locator('.card-action').getByRole('button')
    await expect(action).toBeVisible()
    await drawer
      .locator('.drawer-frame-body')
      .evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    await expect(head).toHaveClass(/condensed/u)

    const pinned = await box(head)
    expect(pinned.height).toBeLessThanOrEqual(PINNED_AT_MOST[width] ?? 0)
    // Which item this is: its title, on one line.
    const title = head.locator('h2')
    const line = await title.evaluate((node) =>
      Number.parseFloat(getComputedStyle(node).lineHeight),
    )
    const named = await box(title)
    expect(named.height).toBeLessThanOrEqual(line + 1)
    // The one action, inside what stays.
    const button = await box(action)
    expect(button.y).toBeGreaterThanOrEqual(pinned.y)
    expect(button.y + button.height).toBeLessThanOrEqual(pinned.y + pinned.height)
    await expect(drawer.locator('.card-facts')).toBeHidden()

    // The sections keep one row, and each one the keyboard reaches is brought into view.
    const tabs = drawer.locator('.inspector-tabs').getByRole('button')
    const tops = await tabs.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
    )
    expect(new Set(tops).size).toBe(1)
    await tabs.first().focus()
    const count = await tabs.count()
    for (let index = 1; index < count; index += 1) {
      await page.keyboard.press('Tab')
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
    // Read in one frame: the drawer may still be sliding in.
    const offset = await description.evaluate((node) => {
      const left = (selector: string) =>
        node.querySelector(selector)?.getBoundingClientRect().left ?? Number.NaN
      return left('.collapsible-toggle') - left('.collapsible-text')
    })
    expect(offset).toBeCloseTo(0, 0)
  })
}

/**
 * Where the head would give a reason in place of the action — an epic, an item
 * waiting on a blocker — the reason is a fact and goes with the facts: kept in
 * the pinned row, a sentence beside the sections squeezed them to one.
 */
test('a read-down epic keeps the row for its sections at 390px', async ({ page }) => {
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
  await drawer
    .locator('.drawer-frame-body')
    .evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
  await expect(drawer.locator('.drawer-frame-head')).toHaveClass(/condensed/u)
  await expect(reason).toBeHidden()
  // The sections take the row up to the column Close stands in, read in one
  // frame because the drawer may still be sliding in.
  const reach = await drawer.locator('.drawer-frame-head').evaluate((head) => {
    const edge = (selector: string) => head.querySelector(selector)?.getBoundingClientRect()
    const strip = edge('.inspector-tabs')
    const close = edge('.drawer-frame-close')
    return (close?.left ?? 0) - (strip?.right ?? 0)
  })
  expect(reach).toBeLessThanOrEqual(16 + 1)
})

/**
 * The takeover question asked from a read-down head is read in full: it takes
 * the row under the title, as in the whole head, rather than the action's cell
 * beside the title, where it pressed the title and the sections to nothing.
 */
for (const width of [1440, 390]) {
  test(`a takeover asked from a read-down card keeps its title and sections at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openLongCard(page, width)
    await drawer
      .locator('.drawer-frame-body')
      .evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    const head = drawer.locator('.drawer-frame-head')
    await expect(head).toHaveClass(/condensed/u)
    await head.getByRole('button', { name: 'Забрать себе' }).click()
    await expect(head.getByRole('button', { name: 'Забрать', exact: true })).toBeVisible()
    const widths = await head.evaluate((node) => {
      const width = (selector: string) =>
        node.querySelector(selector)?.getBoundingClientRect().width ?? 0
      return {
        head: node.getBoundingClientRect().width,
        title: width('h2'),
        tabs: width('.inspector-tabs'),
        question: width('.card-action'),
      }
    })
    // The question and the sections take the head's width less its insets; the title its row.
    expect(widths.question).toBeGreaterThanOrEqual(widths.head - 48 - 1)
    expect(widths.tabs).toBeGreaterThanOrEqual(widths.head - 48 - 1)
    expect(widths.title).toBeGreaterThan(widths.head / 2)
    await head.getByRole('button', { name: 'Отмена' }).click()
    await expect(head.getByRole('button', { name: 'Забрать себе' })).toBeVisible()
  })
}

/**
 * The head condenses at the body's first scroll, not after a head's worth of
 * scrolling: whole at position 0, compact from the first step down, and a card
 * that scrolls less than its head is tall condenses as well. The condensed head
 * holds still at every position, and condensing does not clamp the reader back
 * to the top, which would flip the head whole again.
 */
async function openReadCard(page: Page, width: number, read: 'long' | 'card') {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.setViewportSize({ width, height: 844 })
  await installBackend(page, read === 'long' ? { longRead: true } : {})
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  return drawer
}

for (const width of [1440, 390]) {
  test(`the first scroll condenses a read card's head, and the top restores it whole at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openReadCard(page, width, 'long')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    const { height: whole } = await box(head)
    await expect(head).not.toHaveClass(/condensed/u)

    await body.evaluate((node) => node.scrollTo({ top: 10 }))
    await expect(head).toHaveClass(/condensed/u)

    await body.evaluate((node) => node.scrollTo({ top: 0 }))
    await expect(head).not.toHaveClass(/condensed/u)
    const restored = await box(head)
    expect(Math.abs(restored.height - whole)).toBeLessThan(1)
  })

  test(`a card that scrolls less than its head is tall condenses at its first scroll at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openReadCard(page, width, 'card')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    const { height: whole } = await box(head)
    const rangeOf = () => body.evaluate((node) => node.scrollHeight - node.clientHeight)
    // The same card on a taller viewport scrolls less: about half its head's height
    // is left to scroll, which the old threshold of a head's height plus 24px never reached.
    const first = await rangeOf()
    await page.setViewportSize({
      width,
      height: 844 + Math.max(0, first - Math.round(whole / 2)),
    })
    const range = await rangeOf()
    expect(range).toBeGreaterThan(0)
    expect(range).toBeLessThan(whole)

    await body.evaluate((node) => node.scrollTo({ top: 4 }))
    await expect(head).toHaveClass(/condensed/u)

    await body.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    await expect(head).toHaveClass(/condensed/u)
    const gap = await body.evaluate(
      (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
    )
    expect(Math.abs(gap)).toBeLessThanOrEqual(1)
  })

  test(`the condensed head holds still at every position of a read card at ${width}px`, async ({
    page,
  }) => {
    const drawer = await openReadCard(page, width, 'long')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    const STATE = {
      condensed: /condensed/u,
      whole: /^(?!.*condensed)/u,
    } as const
    const positions = [
      [10, 'condensed'],
      [40, 'condensed'],
      ['end', 'condensed'],
      [0, 'whole'],
    ] as const
    for (const [target, state] of positions) {
      await body.evaluate((node, top) => {
        node.scrollTo({ top: top === 'end' ? node.scrollHeight : top })
      }, target)
      await expect(head).toHaveClass(STATE[state])
      // Twelve samples over 1.2s with the reader still: the state never changes.
      const seen = await body.evaluate(async (node) => {
        const pinned = node.closest('.drawer')?.querySelector('.drawer-frame-head')
        const samples: string[] = []
        for (let index = 0; index < 12; index += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          samples.push(
            `${pinned?.classList.contains('condensed')}|${Math.round(pinned?.getBoundingClientRect().height ?? 0)}|${Math.round(node.scrollTop)}`,
          )
        }
        return samples
      })
      expect(new Set(seen).size, `state at ${target}`).toBe(1)
    }
  })
}

for (const width of [1024, 390]) {
  test(`condensing at the end keeps the reader at the end at ${width}px`, async ({ page }) => {
    const drawer = await openReadCard(page, width, 'long')
    const head = drawer.locator('.drawer-frame-head')
    const body = drawer.locator('.drawer-frame-body')
    await body.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
    await expect(head).toHaveClass(/condensed/u)
    const gap = await body.evaluate(
      (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
    )
    expect(Math.abs(gap)).toBeLessThanOrEqual(1)
  })
}
