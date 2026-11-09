/**
 * «…» in a card's bar, in the built app: the pin lives there, not in the identity line, and
 * the trigger stands with Back and Close on the bar's middle at a desktop's and a phone's
 * width, in both languages.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveRow as frameRow } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { installLiveStreams, servePins } from './liveWorkPage.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

const WORDS = {
  en: { more: 'More', pin: 'Pin to Work', close: 'Close' },
  ru: { more: 'Ещё', pin: 'Закрепить в «Работе»', close: 'Закрыть' },
} as const

/** The busy frame with the card's own item among its rows, not pinned. */
function frameWithCard() {
  const frame = busyFrame()
  frame.spaces[0].rows.push(frameRow(workItemRef.reference, { state: 'working', title: 'Card' }))
  return frame
}

async function openCard(page: Page, width: number, locale: 'en' | 'ru') {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  const sent = await servePins(page, () => frameWithCard())
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-identity')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(frameWithCard())
  return { drawer, sent }
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('not laid out')
  return { ...bounds, right: bounds.x + bounds.width, middle: bounds.y + bounds.height / 2 }
}

for (const locale of ['ru', 'en'] as const)
  for (const width of [1280, 390])
    test(`the pin is in «…» on the bar, beside Close, at ${width}px in ${locale}`, async ({
      page,
    }) => {
      const words = WORDS[locale]
      const { drawer, sent } = await openCard(page, width, locale)
      const bar = drawer.locator('.drawer-frame-bar')
      const trigger = bar.getByRole('button', { name: words.more, exact: true })
      await expect(trigger).toBeVisible()
      await expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
      // The identity line holds who the item is and no pin.
      await expect(drawer.locator('.card-identity button[aria-label*="Work"]')).toHaveCount(0)
      await expect(drawer.locator('.card-identity button[aria-label*="Работ"]')).toHaveCount(0)

      // The trigger stands on the bar's middle, before Close and clear of it and of the identity.
      const close = await box(bar.getByRole('button', { name: words.close, exact: true }))
      const sign = await box(trigger)
      const line = await box(bar)
      expect(sign.middle).toBeCloseTo(line.middle, 0)
      expect(sign.middle).toBeCloseTo(close.middle, 0)
      expect(sign.right).toBeLessThanOrEqual(close.x)
      expect(sign.width).toBe(40)
      expect(sign.height).toBe(40)
      const identity = await box(drawer.locator('.card-identity'))
      expect(identity.right).toBeLessThanOrEqual(sign.x)

      await trigger.click()
      const pin = page.getByRole('menuitemcheckbox', { name: words.pin })
      await expect(pin).toHaveAttribute('aria-checked', 'false')
      const menu = await box(page.getByRole('menu'))
      expect(menu.x).toBeGreaterThanOrEqual(0)
      expect(menu.right).toBeLessThanOrEqual(width)
      await pin.click()
      await expect.poll(() => sent).toEqual([{ id: workItemRef.reference, pinned: true }])
      await expect(page.getByRole('menu')).toHaveCount(0)
      await expect(trigger).toBeFocused()
    })
