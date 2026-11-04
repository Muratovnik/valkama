/**
 * A press on a reference to a card, with a modifier or the middle button: in a browser it is
 * the browser's, as on any link, and opens the card's address in a new tab; in the desktop
 * app, which has no tabs and would hand the address to the system browser, it opens the card
 * in place, as a plain press does.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openReported } from './previewPage.ts'
import { test } from './test.ts'

const BODY = 'Waiting on MAIN-12.'

/** Every page the context opens from now on, by its address. */
function opened(page: Page) {
  const addresses: string[] = []
  page.context().on('page', (other) => addresses.push(other.url()))
  return addresses
}

test('in a browser, Ctrl and the middle button open the card in a new tab', async ({ page }) => {
  const { drawer, entry } = await openReported(page, BODY)
  const link = entry.getByRole('link', { name: 'MAIN-12', exact: true })
  await expect(link).toHaveAttribute('href', '/open/MAIN-12')
  const [tab] = await Promise.all([
    page.context().waitForEvent('page'),
    link.click({ modifiers: ['ControlOrMeta'] }),
  ])
  await tab.close()
  const [middle] = await Promise.all([
    page.context().waitForEvent('page'),
    link.click({ button: 'middle' }),
  ])
  await middle.close()
  // The card here stays where it was.
  await expect(drawer.locator('.head-reference')).toHaveText('MAIN-264')
})

test('in the desktop app, every press opens the card in place', async ({ page }) => {
  await page.addInitScript(() => {
    window.valkamaDesktop = {}
  })
  const { drawer, entry } = await openReported(page, BODY)
  const pages = opened(page)
  const link = () => entry.getByRole('link', { name: 'MAIN-12', exact: true })
  await link().click({ modifiers: ['ControlOrMeta'] })
  await expect(drawer.locator('.head-reference')).toHaveText('MAIN-12')
  await drawer.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(drawer.locator('.head-reference')).toHaveText('MAIN-264')
  await link().click({ button: 'middle' })
  await expect(drawer.locator('.head-reference')).toHaveText('MAIN-12')
  await drawer.getByRole('button', { name: 'Back', exact: true }).click()
  await link().click({ modifiers: ['Shift'] })
  await expect(drawer.locator('.head-reference')).toHaveText('MAIN-12')
  expect(pages).toEqual([])
})
