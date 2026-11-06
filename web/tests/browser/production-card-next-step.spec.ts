/**
 * The next step on a card's first screen, in the built application: a quiet line naming
 * what it is and where it stands in the list, the step's words, and the way to the rest.
 * It stood as a heading of its own, «Что дальше», which did not say it was a step.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

const step = (index: number, done: boolean) => ({
  id: `123e4567-e89b-42d3-a456-4266141742${String(index).padStart(2, '0')}`,
  text: `The step number ${index + 1}`,
  done,
  claimed_by: '',
  done_by: '',
})

/** A list of `count` steps, the ones at the `done` places finished. */
const list = (count: number, done: number[] = []) =>
  Array.from({ length: count }, (_, index) => step(index, done.includes(index)))

async function openCard(
  page: Page,
  checklist: unknown[],
  { closedWith, locale = 'ru', longRead = false, width = 1280 } = {} as {
    closedWith?: string
    locale?: 'en' | 'ru'
    longRead?: boolean
    width?: number
  },
) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 700 })
  await installBackend(page, {
    closedWith,
    longRead,
    card: (read) => ({ ...read, checklist }),
  })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

for (const [locale, words, all] of [
  ['ru', 'Следующий шаг · 3 из 9', 'Все шаги'],
  ['en', 'Next step · 3 of 9', 'All steps'],
] as const) {
  test(`the step says what it is and where it stands in the list, in ${locale}`, async ({
    page,
  }) => {
    const drawer = await openCard(page, list(9, [0, 1]), { locale })
    const next = drawer.locator('.next-step')
    await expect(next.locator('.next-step-label')).toHaveText(words)
    await expect(next.locator('.next-step-text')).toHaveText('The step number 3')
    await expect(next.getByRole('button', { name: all })).toBeVisible()
    // The old heading is gone from the whole screen, and the block has none of its own.
    await expect(drawer.getByRole('heading', { name: /Что дальше|What comes next/u })).toHaveCount(
      0,
    )
    await expect(drawer).not.toContainText('Что дальше')
    await expect(drawer).not.toContainText('What comes next')
    await expect(next.getByRole('heading')).toHaveCount(0)
  })
}

test('the number is the step’s place in the list and not how many are done', async ({ page }) => {
  const drawer = await openCard(page, list(4, [1, 2]))
  await expect(drawer.locator('.next-step-label')).toHaveText('Следующий шаг · 1 из 4')
  await expect(drawer.locator('.next-step-text')).toHaveText('The step number 1')
})

test('the only step has no count and no way to itself', async ({ page }) => {
  const drawer = await openCard(page, list(1))
  const next = drawer.locator('.next-step')
  await expect(next.locator('.next-step-label')).toHaveText('Следующий шаг')
  await expect(next.getByRole('button')).toHaveCount(0)
})

test('the last open step of several still counts and still leads to the list', async ({ page }) => {
  const drawer = await openCard(page, list(3, [0, 1]))
  const next = drawer.locator('.next-step')
  await expect(next.locator('.next-step-label')).toHaveText('Следующий шаг · 3 из 3')
  await expect(next.getByRole('button', { name: 'Все шаги' })).toBeVisible()
})

test('with every step done, or on a closed item, there is no next step', async ({ page }) => {
  const drawer = await openCard(page, list(3, [0, 1, 2]))
  await expect(drawer.locator('.checklist')).toBeVisible()
  await expect(drawer.locator('.next-step')).toHaveCount(0)
  const closed = await openCard(page, list(3), { closedWith: 'It is done.' })
  await expect(closed.locator('.checklist')).toBeVisible()
  await expect(closed.locator('.next-step')).toHaveCount(0)
})

test('the line is quiet and the words read as a description’s, with little height', async ({
  page,
}) => {
  const drawer = await openCard(page, list(9, [0, 1]))
  const next = drawer.locator('.next-step')
  const type = (selector: string) =>
    drawer
      .locator(selector)
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node)
        return { color: style.color, font: style.font, size: style.fontSize }
      })
  const label = await type('.next-step-label')
  const text = await type('.next-step-text')
  expect(label.size).toBe('13px')
  expect(label.color).not.toBe(text.color)
  const description = await type('.description-copy .collapsible-text')
  expect(text.font).toBe(description.font)
  const box = await next.boundingBox()
  // A line and one line of words; the heading, its gap and the words took more.
  expect(box?.height ?? 0).toBeLessThanOrEqual(60)
  // The dot is drawing, and the count reads as words.
  expect(await next.locator('.next-step-label').ariaSnapshot()).not.toContain('·')
})

/** What the heading of the list draws after each way of pressing. */
const RING_AFTER: Record<string, string> = { mouse: 'none', keyboard: 'solid' }

/** The two ways a reader presses a button. */
const PRESSES = {
  mouse: (button: Locator) => button.click(),
  keyboard: async (button: Locator) => {
    await button.focus()
    await button.page().keyboard.press('Enter')
  },
}

for (const width of [1280, 390]) {
  for (const [input, press] of Object.entries(PRESSES)) {
    test(`all steps goes to the list by ${input} and takes focus there, at ${width}px`, async ({
      page,
    }) => {
      const drawer = await openCard(page, list(9, [0, 1]), { longRead: true, width })
      const checklist = drawer.locator('.checklist')
      await expect(checklist).not.toBeInViewport()
      await press(drawer.getByRole('button', { name: 'Все шаги' }))
      const head = drawer.locator('.checklist-head')
      await expect(head).toBeFocused()
      await expect(head).toBeInViewport({ ratio: 1 })
      // It comes to rest under the sticky sections and not behind them, ringed after a key
      // only: the owner chose no ring after a pointer action.
      const tabs = await drawer.locator('.drawer-frame-tabs').boundingBox()
      const rest = await head.boundingBox()
      expect(rest?.y ?? 0).toBeGreaterThanOrEqual((tabs?.y ?? 0) + (tabs?.height ?? 0) - 1)
      await expect(head).toHaveCSS('outline-style', RING_AFTER[input])
      await expect(head).toContainText('2/9')
    })
  }
}

test('at a phone’s width the block keeps to its line and passes the rules', async ({ page }) => {
  const drawer = await openCard(page, list(9, [0, 1]), { width: 390 })
  const next = drawer.locator('.next-step')
  const line = await next.evaluate((node) => {
    const label = node.querySelector('.next-step-label')?.getBoundingClientRect()
    const button = node.querySelector('button')?.getBoundingClientRect()
    return { label: label?.top ?? 0, labelBottom: label?.bottom ?? 0, button: button?.top ?? 99 }
  })
  expect(line.button).toBeLessThan(line.labelBottom)
  await expectNoSilentClipping(page, 'the next step on a phone')
  const results = await new AxeBuilder({ page })
    .include('.drawer .next-step')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
})
