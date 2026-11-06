/**
 * A choice made with the pointer rings nothing: not the option under it, not the trigger the
 * list hands focus back to. The library moves that focus by script, from a press whose own
 * focus it prevented, and the browser rings such a focus unless the last focus it made itself
 * was a pointer's. The same choice made with the keys rings each stop on the way.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute, serve } from './boardPage.ts'
import { test } from './test.ts'

/** What holds focus, and whether it is drawn ringed. */
const focusShown = (page: Page) =>
  page.evaluate(() => {
    const node = document.activeElement
    if (!(node instanceof HTMLElement) || node === document.body) return null
    return {
      role: node.getAttribute('role'),
      text: node.textContent?.trim() ?? '',
      visible: node.matches(':focus-visible'),
      outline: getComputedStyle(node).outlineStyle,
    }
  })

async function expectQuiet(page: Page, role: string) {
  const shown = await focusShown(page)
  expect(shown, `focus stands on a ${role}`).toMatchObject({ role })
  expect(shown, `the ${role} pressed through rings nothing`).toMatchObject({
    visible: false,
    outline: 'none',
  })
}

async function expectRinged(page: Page, role: string) {
  const shown = await focusShown(page)
  expect(shown, `the keys ring the ${role} they reach`).toMatchObject({
    role,
    visible: true,
    outline: 'solid',
  })
}

/** Opens a choice with a press, crosses its options under the pointer and picks one. */
async function chooseWithPointer(page: Page, trigger: Locator, option: RegExp) {
  await trigger.click()
  // The list opens with focus on the option chosen before.
  await expect(page.locator('[role="option"]:focus')).toHaveCount(1)
  await expectQuiet(page, 'option')
  const options = page.getByRole('option')
  // Every option the pointer crosses takes focus from the list: none of them rings.
  for (const index of [1, 0]) {
    await options.nth(index).hover()
    await expect(options.nth(index)).toBeFocused()
    await expectQuiet(page, 'option')
  }
  await page.getByRole('option', { name: option }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expectQuiet(page, 'combobox')
}

async function openComposer(page: Page) {
  await installBackend(page)
  await page.goto(boardRoute())
  await page.getByRole('button', { name: 'New work item' }).click()
  const dialog = page.getByRole('dialog', { name: 'New work' })
  await expect(dialog).toHaveCSS('transform', 'none')
  return dialog
}

// A phone chooses the view from a menu; a desktop has only the scope in one.
for (const [width, choice, option] of [
  [1280, 'Operating scope', /^Example Project/u],
  [390, 'View', /^List$/u],
] as const) {
  test(`at ${width}px the first press of the page makes a choice and rings nothing`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 })
    await installBackend(page)
    await serve(page)
    await page.goto(boardRoute())
    await expect(page.locator('.work-item-board [data-reference]').first()).toBeVisible()
    await chooseWithPointer(page, page.getByRole('combobox', { name: choice, exact: true }), option)
  })
}

for (const width of [1280, 390]) {
  test(`at ${width}px a choice by the pointer rings nothing and one by the keys rings`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const dialog = await openComposer(page)
    const kind = dialog.getByRole('combobox', { name: 'Kind', exact: true })
    const priority = dialog.getByRole('combobox', { name: 'Priority', exact: true })
    await chooseWithPointer(page, kind, /^Epic$/u)
    await expect(kind).toContainText('Epic')
    await chooseWithPointer(page, priority, /^High/u)
    await expect(priority).toContainText('High')

    // The same trigger, now from the keys: the list opens on the chosen option and the
    // arrows walk it, ringed at each step, and the choice hands back a ringed trigger. The
    // pointer goes off the dialog first, or the list opens under it and it chooses there.
    await page.mouse.move(0, 0)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('option', { name: 'High', exact: true })).toBeFocused()
    await expectRinged(page, 'option')
    await page.keyboard.press('ArrowDown')
    await expectRinged(page, 'option')
    const walked = await focusShown(page)
    const reached = walked?.text ?? ''
    await page.keyboard.press('Enter')
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(priority).toBeFocused()
    await expect(priority).toContainText(reached)
    await expectRinged(page, 'combobox')

    // A Tab after a press rings where it lands, as it always has.
    await priority.click()
    await page.getByRole('option').first().click()
    await expectQuiet(page, 'combobox')
    await page.keyboard.press('Shift+Tab')
    await expect(kind).toBeFocused()
    await expectRinged(page, 'combobox')
  })
}
