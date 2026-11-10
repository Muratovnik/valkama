/**
 * «Open session» on a row of the list of work going on now whose item a session stands
 * behind: a target as big as the pin beside it, the row's line by the pin's width on the rail
 * at 1280 and a finger's square in the phone's panel at 390, in English and in Russian; named
 * after the item whose session it opens; and on no row with no session behind it. On the rail
 * it has no column at rest: the row's words have the room the pin's column leaves them, as a
 * row with no session does, and give it up only while the control is up, under the pointer or
 * the keyboard, with nothing else in the row moving. A session's own row is a button that
 * opens the session, with neither a pin nor «Open session». How it comes up is
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

/**
 * A rail row's widths and what must stay put: the row's inner width, its lead and gap, the
 * link, the words (title and second line), «Open session», and the row's height with the x
 * of the sign's lead, the number and the pin.
 */
const rowLayout = (row: Locator) =>
  row.evaluate((node) => {
    const style = getComputedStyle(node)
    const box = (selector: string) =>
      node.querySelector(selector)?.getBoundingClientRect() ?? new DOMRect()
    return {
      inner:
        node.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight),
      gap: Number.parseFloat(style.columnGap),
      lead: box('.nav-row-lead').width,
      link: box('.nav-row-link').width,
      linkHeight: box('.nav-row-link').height,
      words: box('.nav-row-words').width,
      open: box('.nav-row-open').width,
      still: {
        height: node.getBoundingClientRect().height,
        lead: box('.nav-row-lead').x,
        number: box('.nav-row-number').x,
        pin: box('.nav-row-pin').x,
      },
    }
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
        // On the rail it has its size only while it is up; in the phone's panel it stands.
        await row.hover()
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

    test('on the rail it takes a column only while it is up, and only its row’s words shorten', async ({
      page,
    }) => {
      const within = await open(page, 1280)
      const row = liveRow(page, 'MAIN-12', within)
      await page.mouse.move(1, 1)
      const rest = await rowLayout(row)
      const column = await tokenOf(page, '--size-control-inline')
      // At rest the row is laid out as before the control had a column: the lead, the link
      // and the pin's one column, with a gap between each, across the row's inner width.
      expect(rest.link).toBeCloseTo(rest.inner - rest.lead - 2 * rest.gap - column, 2)
      expect(rest.open).toBe(0)
      expect(await size(liveRow(page, 'MAIN-31', within).locator('.nav-row-link'))).toEqual({
        width: rest.link,
        height: rest.linkHeight,
      })

      // Up under the pointer, it takes its column and a gap from the words, nothing else.
      await row.locator('.nav-row-title').hover()
      const hovered = await rowLayout(row)
      test.info().annotations.push({
        type: 'measured',
        description: JSON.stringify({ rest, hovered }),
      })
      expect(hovered.open).toBe(column)
      expect(hovered.link).toBeCloseTo(rest.link - column - rest.gap, 2)
      expect(hovered.words).toBeCloseTo(rest.words - column - rest.gap, 2)
      expect(hovered.still).toEqual(rest.still)

      // Reached from the keyboard: the row's link, then «Open session», then the pin.
      await page.mouse.move(1, 1)
      await expect.poll(() => rowLayout(row).then(({ open }) => open)).toBe(0)
      // Into the link from the stop before it, so the keyboard, not a script, holds focus.
      await row.locator('.nav-row-link').focus()
      await page.keyboard.press('Shift+Tab')
      await page.keyboard.press('Tab')
      await expect(row.locator('.nav-row-link')).toBeFocused()
      expect(await rowLayout(row)).toEqual(hovered)
      await page.keyboard.press('Tab')
      await expect(row.getByRole('button', { name, exact: true })).toBeFocused()
      expect(await rowLayout(row)).toEqual(hovered)
      await page.keyboard.press('Tab')
      await expect(row.locator('.nav-row-pin')).toBeFocused()
      expect(await rowLayout(row)).toEqual(hovered)

      // While its press is carried out it keeps its column, with the pointer gone.
      await page.route('**/api/open-plan?*', () => null)
      const control = row.getByRole('button', { name, exact: true })
      await row.locator('.nav-row-title').hover()
      await control.click()
      await page.mouse.move(1, 1)
      await expect(control).toHaveAttribute('aria-busy', 'true')
      expect(await rowLayout(row)).toEqual(hovered)
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
