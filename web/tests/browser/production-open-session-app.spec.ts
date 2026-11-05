/**
 * A press on a session in the desktop app, in the real page. The bridge is a stand-in that
 * answers as `desktop/session_opener.js` does from the plan the server really gives the app
 * (the committed fixture), so nothing starts outside the browser.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import desktopPlan from '../fixtures/server/open-plan-session-desktop.json' with { type: 'json' }
import { installBackend } from './backend.ts'
import { heldCard, IN_VSCODE, openPlanFor } from './openSessionFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** What the app answers a first press with: every step when one press may run them all. */
const answerToPress = {
  ok: true,
  mode: 'opened',
  next: desktopPlan.one_action ? null : 1,
  plan: desktopPlan,
}

/** The card, in an app whose bridge gives `answer` and records what it was asked. */
async function openInApp(page: Page, answer: unknown, locale: 'en' | 'ru' = 'en') {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.addInitScript(
    ({ answered, language }) => {
      localStorage.setItem('valkama-locale', language)
      const asked: unknown[] = []
      Object.assign(window, {
        askedOfApp: asked,
        valkamaDesktop: {
          onOpenRoute: () => {},
          openSession: async (request: unknown) => {
            asked.push(request)
            return answered
          },
        },
      })
    },
    { answered: answer, language: locale },
  )
  await installBackend(page, { card: heldCard, openPlan: openPlanFor })
  await page.goto(CARD)
  const button = page.locator(`.drawer .card-holder button.open-action`)
  await expect(button).toBeVisible()
  return button
}

const asked = (page: Page) =>
  page.evaluate(() => (window as unknown as { askedOfApp: unknown[] }).askedOfApp)

test.describe('a press on a session in the app', () => {
  test('a session in an editor opens at once, with no dialog', async ({ page }) => {
    const button = await openInApp(page, answerToPress)
    await button.click()
    await expect(page.locator('.notice')).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Open session' })).toHaveCount(0)
    expect(await asked(page)).toEqual([{ session: IN_VSCODE, fallback: 'vscode' }])
  })

  test('a session running elsewhere still says so, and opens nothing', async ({ page }) => {
    const button = await openInApp(page, {
      ok: false,
      mode: 'explained',
      reason: 'live-elsewhere',
      next: null,
      plan: desktopPlan,
    })
    await button.click()
    await expect(page.locator('.notice')).toContainText('It runs somewhere else')
    await expect(page.getByRole('dialog', { name: 'Open session' })).toHaveCount(0)
  })

  test('a session in a terminal still leads to its panel, with what can be done', async ({
    page,
  }) => {
    const button = await openInApp(page, {
      ok: false,
      mode: 'explained',
      reason: 'live-in-terminal',
      next: 1,
      plan: desktopPlan,
    })
    await button.click()
    const panel = page.getByRole('dialog', { name: 'The session is running' })
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('It runs in a terminal')
  })
})
