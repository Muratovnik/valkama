import { expect } from '@playwright/test'
import type { Route } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

const planningRead = (url: URL) => url.pathname === '/api/planning'

test('a stalled board read settles with a localized recovery action and can retry', async ({
  page,
}) => {
  await installBackend(page)
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await page.clock.install()
  let stalled: Route | undefined
  await page.route(planningRead, (route) => {
    stalled = route
  })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await expect.poll(() => stalled !== undefined).toBe(true)
  // While it is read, the bar stands and the stage says so.
  await expect(page.locator('.workspace-head')).toBeVisible()
  await expect(page.locator('.workspace-stage .workspace-reading')).toHaveAttribute(
    'aria-busy',
    'true',
  )
  await page.clock.runFor(15_001)
  const failure = page.locator('[data-scroll-owner="planning-state"] [role="alert"]')
  await expect(failure).toContainText('Локальный сервис не ответил вовремя')
  await expect(failure.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible()
  await expect(
    page.locator('[aria-busy="true"]:is(.workspace-reading, .platform-state-panel)'),
  ).toHaveCount(0)
  await stalled?.abort()
  await page.unroute(planningRead)
  await failure.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  await expect(failure).toHaveCount(0)
})
