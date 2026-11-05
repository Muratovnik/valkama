/**
 * Points of a list in the discussion made steps of the item, in the built app and through the
 * route the interface writes a checklist by: the icon stands on an entry with a list and on no
 * other, the form is driven with the keys at both widths, the steps it sends join the card's
 * checklist, and the form keeps its edge and its boxes in a forced palette.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openCard } from './editorPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { doneState } from './planningFixtures.ts'
import { test } from './test.ts'
import { reply, root } from './threadFixtures.ts'

const LIST = [
  'What is left on this task:',
  '1. Frontend contract',
  '2. Wire the route',
  '   - with its test',
  '3. Review the copy',
].join('\n')

/** The card with a comment holding a list, one without, and a reply holding one. */
async function openListed(page: Page, width = 1280, closed = false) {
  await page.setViewportSize({ width, height: 900 })
  const opened = await openCard(page)
  opened.backend.item.comments.push(
    root(1, LIST),
    root(2, 'Nothing to list here, 1. not even this.'),
    reply(3, 2, '- A point from a reply'),
  )
  if (closed) opened.backend.item.state = { ...doneState }
  await page.reload()
  const { drawer } = opened
  await expect(drawer.locator('.thread-entry').first()).toBeVisible()
  const threadOf = (text: string) => drawer.locator('.thread-entry').filter({ hasText: text })
  return { ...opened, listed: threadOf('What is left'), plain: threadOf('Nothing to list') }
}

const ACTION = 'Make steps'

for (const width of [1280, 390]) {
  test(`at ${width} a list becomes steps from the keyboard and joins the checklist`, async ({
    page,
  }) => {
    const { backend, drawer, listed, plain } = await openListed(page, width)
    const action = listed.getByRole('button', { name: ACTION, exact: true })
    await expect(action).toHaveAttribute('aria-expanded', 'false')
    // The comment's head, not its reply: the reply has a list of its own.
    await expect(
      plain.locator('.entry-head').first().getByRole('button', { name: ACTION }),
    ).toHaveCount(0)
    await expect(plain.locator('.reply').getByRole('button', { name: ACTION })).toHaveCount(1)

    await action.focus()
    await page.keyboard.press('Enter')
    await expect(action).toHaveAttribute('aria-expanded', 'true')
    const form = listed.locator('.steps-form')
    const box = (name: string) => form.getByRole('checkbox', { name })
    // The card has «Frontend contract» as a step already: shown, and not to be ticked.
    await expect(box('Frontend contract')).toBeDisabled()
    await expect(box('Frontend contract')).not.toBeChecked()
    await expect(box('Frontend contract')).toHaveAccessibleDescription('already a step')
    await expect(box('Wire the route')).toBeFocused()
    await expect(form.locator('.steps-count')).toHaveText('Will be 4 steps of 100')

    await page.keyboard.press('Tab')
    await expect(box('with its test')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(box('Review the copy')).toBeFocused()
    await page.keyboard.press('Space')
    await expect(box('Review the copy')).not.toBeChecked()
    await expect(form.locator('.steps-count')).toHaveText('Will be 3 steps of 100')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    const add = form.getByRole('button', { name: 'Add 2 steps', exact: true })
    await expect(add).toBeFocused()
    await expectNoSilentClipping(page, `the steps form at ${width}`)
    const overflow = await drawer.evaluate((node) => node.scrollWidth - node.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    await page.keyboard.press('Enter')
    await expect(listed.locator('.entry-steps-added')).toContainText('Added 2 steps')
    await expect(action).toBeFocused()
    expect(backend.writes.at(-1)).toEqual({
      author: 'user',
      id: backend.item.work_item_id,
      items: [
        { id: backend.item.checklist[0]?.id, text: 'Frontend contract' },
        'Wire the route',
        'with its test',
      ],
      expected_revision: 3,
    })
    const checklist = drawer.locator('.checklist')
    await expect(checklist).toContainText('Wire the route')
    await expect(checklist).toContainText('with its test')
    // The checklist grew above the discussion after the form went; the line is still in view.
    await expect(listed.locator('.entry-steps-added')).toBeInViewport()

    await listed.getByRole('button', { name: 'Show checklist', exact: true }).click()
    await expect(drawer.locator('.checklist-head')).toBeFocused()

    // Opened again, what was added reads as the card's own steps.
    await action.click()
    await expect(box('Wire the route')).toHaveAccessibleDescription('already a step')
    await expect(box('Review the copy')).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(form).toHaveCount(0)
    await expect(action).toBeFocused()
  })
}

test('the form and what it leaves behind pass the WCAG AA rules', async ({ page }) => {
  const { listed } = await openListed(page, 390)
  await listed.getByRole('button', { name: ACTION, exact: true }).click()
  const violations = async () => {
    const results = await new AxeBuilder({ page })
      .include('.drawer .thread-entry')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    return results.violations.map((violation) => violation.id)
  }
  expect(await violations()).toEqual([])
  await listed.locator('.steps-form').getByRole('button', { name: /^Add/u }).click()
  await expect(listed.locator('.entry-steps-added')).toBeVisible()
  expect(await violations()).toEqual([])
})

test('a closed task offers no steps on any entry', async ({ page }) => {
  const { drawer } = await openListed(page, 1280, true)
  await expect(drawer.locator('.thread-entry').first()).toBeVisible()
  await expect(drawer.getByRole('button', { name: ACTION })).toHaveCount(0)
})

test('a write refused for a newer revision keeps the ticks for the next one', async ({ page }) => {
  const { backend, listed } = await openListed(page)
  await listed.getByRole('button', { name: ACTION, exact: true }).click()
  const form = listed.locator('.steps-form')
  await form.getByRole('checkbox', { name: 'with its test' }).uncheck()
  backend.failNextWrite()
  await form.getByRole('button', { name: 'Add 2 steps', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('The task changed.')
  await form.getByRole('button', { name: 'Refresh task', exact: true }).click()
  await expect(form.getByRole('checkbox', { name: 'with its test' })).not.toBeChecked()
  await form.getByRole('button', { name: 'Add 2 steps', exact: true }).click()
  await expect(listed.locator('.entry-steps-added')).toContainText('Added 2 steps')
  expect(backend.writes.at(-1)?.expected_revision).toBe(4)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the form keeps its edge and its boxes in the ${colorScheme} forced palette`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    const { listed } = await openListed(page)
    await listed.getByRole('button', { name: ACTION, exact: true }).click()
    const form = listed.locator('.steps-form')
    const look = await form.evaluate((node) => {
      const box = node.querySelector('input[type="checkbox"]') as Element
      return {
        edge: getComputedStyle(node).outlineStyle,
        box: getComputedStyle(box).appearance,
      }
    })
    expect(look.edge).toBe('solid')
    // The system draws the boxes, so they keep the palette's own marks.
    expect(look.box).toBe('auto')
  })
}
