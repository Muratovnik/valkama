/**
 * A control a read disables while it waits takes the focus back once the read has failed, as
 * one a write disables does (DESIGN.md, «Accessibility»): Chrome takes focus off a control
 * disabled under it, to the page, and a failed read left it there. It stays disabled while it
 * waits, so a second press asks nothing more, and the next Tab goes where it went from it before.
 *
 * Read on a card's chain, whose Retry is hidden with its failure while the read waits; in
 * Settings, the Diagnostics' Check again; and on the rail, the lost connection's refresh, at a
 * desktop's two widths in both languages; and the Refresh of the panel a narrow rail opens
 * instead, which closes as focus leaves it, so the focus goes to the dot that opened it.
 * Each read held back by the test and failed as the server says. A refresh that brings the
 * connection back takes the control away, from the rail and from the narrow rail's panel, and
 * the focus it held goes to the rail's entry on show, ringed after a key and not after a press.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { openCard } from './editorPage.ts'
import { frames } from './frames.ts'
import {
  failRead,
  focusedByKey,
  heldWrites,
  onThePage,
  onwardFrom,
  pressHeld,
  tabGoesOn,
} from './heldWrite.ts'
import { spaceScope } from './planningFixtures.ts'
import { installStreamDouble } from './streamDouble.ts'
import { test } from './test.ts'

const WORDS = {
  en: { chain: 'Chain', diagnostics: 'Diagnostics' },
  ru: { chain: 'Цепочка', diagnostics: 'Диагностика' },
} as const

/** A read the double answers as it does any. */
const answered = (route: Route) => route.fallback()

/** The ways a refresh is pressed: with Enter, a click, and a double click. */
const PRESSES = {
  'key': async (page: Page, control: Locator) => {
    await control.focus()
    await page.keyboard.press('Enter')
  },
  'pointer': (_page: Page, control: Locator) => control.click(),
  'double click': (_page: Page, control: Locator) => control.dblclick(),
}
type Press = keyof typeof PRESSES

/** The rail's entry on show, which the focus of a control the connection took away goes to. */
const entryOnShow = (page: Page) => page.locator('.app-nav .nav-item.module-planning')

/** The board with its stream delivered and then dropped: the rail says the connection is lost. */
async function lostConnection(page: Page) {
  await installBackend(page)
  const stream = await installStreamDouble(page)
  const read = page.waitForResponse((response) => response.url().includes('/api/planning?'))
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
  const response = await read
  await stream.deliver(await response.text())
  await stream.drop()
  const rail = page.locator('.nav-refresh')
  await expect(rail).toHaveAttribute('data-tone', 'warning')
  return rail
}

for (const width of [1440, 1024] as const)
  for (const lang of ['en', 'ru'] as const)
    test.describe(`a read held from the keyboard at ${String(width)} in ${lang}`, () => {
      test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })
      const words = WORDS[lang]

      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
      })

      test('a chain’s Retry pressed with Enter has the focus back once its read fails again', async ({
        page,
      }) => {
        const { backend, drawer } = await openCard(page, () =>
          page.route('**/api/planning/work-item/chain?*', failRead),
        )
        backend.item.kind = 'goal'
        await page.reload()
        await expect(drawer).toHaveCSS('transform', 'none')
        await drawer.getByRole('tab', { name: words.chain, exact: true }).click()
        const failure = drawer.locator('.chain-failure')
        const retry = failure.getByRole('button')
        const { release, sent } = await heldWrites(
          page,
          '/api/planning/work-item/chain?*',
          failRead,
          true,
        )
        const onward = await onwardFrom(page, retry)
        await retry.focus()
        await page.keyboard.press('Enter')
        // The failure and its Retry give way to the wait for as long as the read waits.
        await expect(failure).toBeHidden()
        await onThePage(page)
        await page.keyboard.press('Enter')
        expect(sent).toHaveLength(1)

        release()
        await expect(failure).toBeVisible()
        await frames(drawer)
        await focusedByKey(retry)
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })

      test('Check again pressed with Enter has the focus back once the report fails', async ({
        page,
      }) => {
        await installBackend(page)
        await page.goto(serializePlatformRoute({ module_id: 'settings', scope: spaceScope }))
        await page.getByRole('tab', { name: words.diagnostics, exact: true }).click()
        const again = page.locator('.installation-health .health-head').getByRole('button')
        await expect(again).toBeEnabled()
        const { release, sent } = await heldWrites(page, '/api/doctor*', failRead, true)
        const onward = await pressHeld(page, again, 'Enter', sent)

        release()
        await expect(again).toBeEnabled()
        await frames(page.locator('.installation-health'))
        await focusedByKey(again)
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })

      test('a lost connection’s refresh pressed with Enter has the focus back once it fails', async ({
        page,
      }) => {
        const rail = await lostConnection(page)
        const { release, sent } = await heldWrites(page, '/api/modules', failRead, true)
        const onward = await pressHeld(page, rail, 'Enter', sent)

        release()
        await expect(rail).toBeEnabled()
        await frames(rail)
        await focusedByKey(rail)
        await tabGoesOn(page, onward)
        expect(sent).toHaveLength(1)
      })

      for (const input of ['key', 'pointer', 'double click'] as const satisfies Press[])
        test(`a lost connection’s refresh by ${input} that brings it back gives the focus to the entry on show`, async ({
          page,
        }) => {
          const rail = await lostConnection(page)
          const entry = entryOnShow(page)
          const onward = await onwardFrom(page, entry)
          const { release, sent } = await heldWrites(page, '/api/modules', answered, true)
          await PRESSES[input](page, rail)
          await expect(rail).toBeDisabled()
          await onThePage(page)

          release()
          await expect(rail).toHaveCount(0)
          await frames(entry)
          await expect(entry).toBeFocused()
          expect(await entry.evaluate((node) => node.matches(':focus-visible'))).toBe(
            input === 'key',
          )
          await tabGoesOn(page, onward)
          expect(sent).toHaveLength(1)
        })
    })

test('the narrow rail’s Refresh pressed with Enter gives the focus to its dot once it fails', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const rail = await lostConnection(page)
  await rail.click()
  const refresh = page.locator('.nav-tip-action')
  await expect(refresh).toBeVisible()
  const { release, sent } = await heldWrites(page, '/api/modules', failRead, true)
  // The panel's last control: a Tab from it leaves the panel, so the press is made here alone.
  await refresh.focus()
  await page.keyboard.press('Enter')
  // Disabled under focus, which fell to the page: focus leaving the panel closes it.
  await expect(refresh).toHaveCount(0)
  await expect(rail).toBeDisabled()
  await onThePage(page)
  await page.keyboard.press('Enter')
  expect(sent).toHaveLength(1)

  release()
  // The dot that opened the panel has the focus, as after Escape.
  await frames(rail)
  await focusedByKey(rail)
  await expect(rail).toBeEnabled()
  expect(sent).toHaveLength(1)
})

for (const width of [390, 320] as const)
  for (const lang of ['en', 'ru'] as const)
    test.describe(`the narrow rail at ${String(width)} in ${lang}`, () => {
      test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

      test('its Refresh that brings the connection back gives the focus to the entry on show', async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 })
        const rail = await lostConnection(page)
        await rail.click()
        const refresh = page.locator('.nav-tip-action')
        await expect(refresh).toBeVisible()
        const { release, sent } = await heldWrites(page, '/api/modules', answered, true)
        await refresh.focus()
        await page.keyboard.press('Enter')
        await expect(refresh).toHaveCount(0)

        release()
        await expect(rail).toHaveCount(0)
        const entry = entryOnShow(page)
        await frames(entry)
        await focusedByKey(entry)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        ).toBe(0)
        expect(sent).toHaveLength(1)
      })
    })
