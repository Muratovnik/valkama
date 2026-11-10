/**
 * «Open session» on a row of the list of work going on now whose item a session stands
 * behind: a target as big as the pin beside it, the row's line by the pin's width on the rail
 * at 1280 and a finger's square in the phone's panel at 390, in English and in Russian; named
 * after the item whose session it opens; and on no row with no session behind it, whose
 * columns stand where a row with one has them. A session's own row is a button that opens
 * the session, with neither a pin nor «Open session». How it comes up is
 * `production-reveal-actions.spec.ts`.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame, liveSession } from '../support/liveFrame.ts'
import { installBackend } from './backend.ts'
import { settled } from './documentBeside.ts'
import { installLiveStreams, liveRow } from './liveWorkPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })

/** The busy frame with a session behind MAIN-12, pinned so that its pin stands on a phone too. */
function frame() {
  const busy = busyFrame()
  const row = busy.spaces[0].rows.find((each) => each.reference === 'MAIN-12')
  if (row) {
    row.executor = liveSession('00000000-0000-4000-8000-000000000201').executor
    row.pinned = true
  }
  return busy
}

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  await streams.live(frame())
  await page.evaluate(() => document.fonts.ready)
  if (width > 760) return '.nav-work-list'
  await page.locator('.nav-work-rail').click()
  await settled(page.getByRole('dialog', { name: /Work|Работа/u }))
  return '.side-panel-body'
}

const size = (part: Locator) =>
  part.evaluate((node) => {
    const { height, width } = node.getBoundingClientRect()
    return { height, width }
  })

const tokenOf = (page: Page, name: string) =>
  page.evaluate(
    (property) =>
      Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(property)),
    name,
  )

for (const { locale, name } of [
  { locale: 'en-US', name: 'Open the session of MAIN-12 Answer a review in one form' },
  { locale: 'ru-RU', name: 'Открыть сессию MAIN-12 Answer a review in one form' },
]) {
  test.describe(`«Open session» on a row, ${locale}`, () => {
    test.use({ locale })

    // The pin's size: its width by the row's line on the rail, a finger's square on a phone.
    for (const { width, side } of [
      { width: 1280, side: '--size-control-inline' },
      { width: 390, side: '--size-control-target' },
    ]) {
      test(`is as big a target as the pin and says whose session it opens, at ${width}`, async ({
        page,
      }) => {
        const within = await open(page, width)
        const row = liveRow(page, 'MAIN-12', within)
        const control = row.getByRole('button', { name, exact: true })
        await expect(control).toHaveCount(1)
        const pin = await size(row.locator('.nav-row-pin'))
        const opens = await size(control)
        test
          .info()
          .annotations.push({ type: 'measured', description: JSON.stringify({ pin, opens }) })
        expect(opens).toEqual(pin)
        const token = await tokenOf(page, side)
        expect(opens).toEqual({ width: token, height: token })
        // A row with no session behind it has none.
        await expect(liveRow(page, 'MAIN-31', within).locator('.nav-row-open')).toHaveCount(0)
      })
    }

    test('a row with no session keeps the column «Open session» takes on the rail', async ({
      page,
    }) => {
      const within = await open(page, 1280)
      const link = await size(liveRow(page, 'MAIN-12', within).locator('.nav-row-link'))
      expect(await size(liveRow(page, 'MAIN-31', within).locator('.nav-row-link'))).toEqual(link)
    })

    test('a session’s own row opens the session and has neither pin nor «Open session»', async ({
      page,
    }) => {
      const within = await open(page, 1280)
      const session = page.locator(`${within} .nav-row`, {
        has: page.locator('.nav-row-title', { hasText: 'Session 0101' }),
      })
      await expect(session.locator('button.nav-row-link')).toHaveCount(1)
      await expect(session.locator('a')).toHaveCount(0)
      await expect(session.locator('.nav-row-pin, .nav-row-open')).toHaveCount(0)
    })
  })
}
