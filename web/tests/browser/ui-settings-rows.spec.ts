/**
 * The scoped settings row and the scope above it, as Settings lays them out: nothing runs out
 * of its row at the widths the app supports, the choices start where the column starts, and
 * the keyboard switches an own value on and moves its choice without leaving the row.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { test } from './test.ts'

const SURFACE = '/tests/browser/harness.html?lang=ru&surface=settings-rows'

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 2400 })
  await page.goto(SURFACE)
  await expect(page.locator('.settings-rows-sheet')).toBeVisible()
}

for (const width of [1280, 760, 390]) {
  test(`no part of a row runs out of it at ${width}px`, async ({ page }) => {
    await open(page, width)

    const measured = await page.evaluate(() => {
      const frame = document.querySelector('.module-frame')
      const rows = [...document.querySelectorAll('.settings-row')].map((row) => {
        const outer = row.getBoundingClientRect()
        const control = row.querySelector('.settings-row-control')?.getBoundingClientRect()
        const escaping = [...row.querySelectorAll('*')]
          .filter((part) => {
            const box = part.getBoundingClientRect()
            return box.width > 0 && (box.right > outer.right + 0.5 || box.left < outer.left - 0.5)
          })
          .map((part) => part.className || part.tagName)
        return { name: row.querySelector('.settings-row-label')?.textContent, control, escaping }
      })
      return { scroll: frame && frame.scrollWidth - frame.clientWidth, rows }
    })

    expect(measured.scroll).toBe(0)
    for (const row of measured.rows) expect(row.escaping, row.name ?? '').toEqual([])
    // One column edge for every choice, scope rows and scoped rows alike.
    expect(new Set(measured.rows.map((row) => Math.round(row.control?.left ?? -1))).size).toBe(1)
  })
}

test('a choice is as wide as its segments, not as the column', async ({ page }) => {
  await open(page, 1280)
  for (const name of ['scope-space', 'shared']) {
    const row = page.locator(`[data-row="${name}"]`)
    const column = await row.locator('.settings-row-control').boundingBox()
    const choice = await row.getByRole('radiogroup').boundingBox()
    expect(choice?.x).toBe(column?.x)
    // Stretched, its track ran to the column's far edge with the segments at its start.
    expect(choice?.width ?? Number.POSITIVE_INFINITY).toBeLessThan((column?.width ?? 0) - 40)
  }
})

test('the keyboard switches an own value on and moves its choice, named by the row', async ({
  page,
}) => {
  await open(page, 1280)
  const row = page.locator('[data-row="inheriting"]')
  const own = row.getByRole('switch')
  await expect(row).toContainText('Общее: Человек')
  await expect(row.getByRole('radiogroup')).toHaveCount(0)

  await own.focus()
  await page.keyboard.press('Space')
  await expect(own).toHaveAttribute('aria-checked', 'true')
  const human = row.getByRole('radio', { name: 'Человек' })
  await expect(human).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Tab')
  await expect(human).toBeFocused()

  await page.keyboard.press('ArrowLeft')
  const agent = row.getByRole('radio', { name: 'Агент' })
  await expect(agent).toHaveAttribute('aria-checked', 'true')
  await expect(agent).toBeFocused()
  const choice = row.getByRole('radiogroup')
  await expect(choice).toHaveAccessibleName(/^Цель, которую агент предложил сам/)
  await expect(choice).toHaveAccessibleDescription('Решает агент и пишет, почему.')

  await own.focus()
  await page.keyboard.press('Space')
  await expect(own).toHaveAttribute('aria-checked', 'false')
  await expect(row.getByRole('radiogroup')).toHaveCount(0)
  await expect(own).toBeFocused()
})
