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
      const app = { asked: [] as unknown[], answer: answered }
      Object.assign(window, {
        app,
        valkamaDesktop: {
          onOpenRoute: () => {},
          openSession: async (request: unknown) => {
            app.asked.push(request)
            return app.answer
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

interface StandIn {
  app: { answer: unknown; asked: unknown[] }
}

const asked = (page: Page) => page.evaluate(() => (window as unknown as StandIn).app.asked)

/** What the app answers from now on. */
const appAnswers = (page: Page, answer: unknown) =>
  page.evaluate((next) => {
    ;(window as unknown as StandIn).app.answer = next
  }, answer)

/** The card in the app with the page's clock installed before it loads, and standing still. */
async function pressable(page: Page, answer: unknown) {
  await page.clock.install({ time: new Date('2026-11-05T12:00:00Z') })
  const button = await openInApp(page, answer)
  await page.clock.pauseAt(new Date('2026-11-05T13:00:00Z'))
  return button
}

const notice = (page: Page) => page.locator('.notice')

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

const windowEvent = (page: Page, event: 'blur' | 'focus') =>
  page.evaluate((name) => window.dispatchEvent(new Event(name)), event)

test.describe('the notice of what a press did', () => {
  test('what was done goes by itself after five seconds', async ({ page }) => {
    const button = await pressable(page, answerToPress)
    await button.click()
    await expect(notice(page)).toBeVisible()
    await page.clock.runFor(4900)
    await expect(notice(page)).toBeVisible()
    await page.clock.runFor(200)
    await expect(notice(page)).toHaveCount(0)
    await expect(page.locator('#app > [role="status"]')).toHaveText('')
  })

  test('it stays under the pointer, and finishes its time after', async ({ page }) => {
    const button = await pressable(page, answerToPress)
    await button.click()
    await notice(page).hover()
    await page.clock.runFor(60_000)
    await expect(notice(page)).toBeVisible()
    await page.mouse.move(5, 5)
    await page.clock.runFor(4900)
    await expect(notice(page)).toBeVisible()
    await page.clock.runFor(200)
    await expect(notice(page)).toHaveCount(0)
  })

  test('it stays while focus is on it', async ({ page }) => {
    const button = await pressable(page, answerToPress)
    await button.click()
    await notice(page).locator('.notice-dismiss').focus()
    await page.clock.runFor(60_000)
    await expect(notice(page)).toBeVisible()
    await button.focus()
    await page.clock.runFor(5100)
    await expect(notice(page)).toHaveCount(0)
  })

  // The editor takes the focus before the app answers: the person has seen nothing yet.
  test('it waits for a person who is in another window, from before it appeared', async ({
    page,
  }) => {
    const button = await pressable(page, answerToPress)
    await windowEvent(page, 'blur')
    await button.click()
    await expect(notice(page)).toBeVisible()
    await page.clock.runFor(60_000)
    await expect(notice(page)).toBeVisible()
    await windowEvent(page, 'focus')
    await page.clock.runFor(4900)
    await expect(notice(page)).toBeVisible()
    await page.clock.runFor(200)
    await expect(notice(page)).toHaveCount(0)
  })

  test('it stops counting when the window loses focus while it shows', async ({ page }) => {
    const button = await pressable(page, answerToPress)
    await button.click()
    await page.clock.runFor(3000)
    await windowEvent(page, 'blur')
    await page.clock.runFor(60_000)
    await expect(notice(page)).toBeVisible()
    await windowEvent(page, 'focus')
    await page.clock.runFor(1900)
    await expect(notice(page)).toBeVisible()
    await page.clock.runFor(200)
    await expect(notice(page)).toHaveCount(0)
  })

  test('the next notice starts the time over', async ({ page }) => {
    const button = await pressable(page, answerToPress)
    await button.click()
    await page.clock.runFor(4000)
    await button.click()
    await expect.poll(() => asked(page).then((calls) => calls.length)).toBe(2)
    await page.clock.runFor(4900)
    await expect(notice(page)).toBeVisible()
    await page.clock.runFor(200)
    await expect(notice(page)).toHaveCount(0)
  })

  test('a name that is one long word breaks inside the box on a phone', async ({ page }) => {
    const button = await openInApp(page, answerToPress)
    await button.click()
    await page.setViewportSize({ width: 390, height: 780 })
    const words = notice(page).locator('.notice-message')
    await words.evaluate((node) => {
      node.textContent = `File ${'long-name-without-a-space_'.repeat(8)}.md opened in VS Code`
    })
    const overflow = await notice(page).evaluate((box) => box.scrollWidth - box.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(notice(page)).toBeInViewport({ ratio: 1 })
  })

  test('a refusal stays until it is put away', async ({ page }) => {
    const button = await pressable(page, {
      ok: false,
      mode: 'refused',
      reason: 'launch-failed',
      next: null,
      plan: desktopPlan,
    })
    await button.click()
    await expect(notice(page)).toContainText('The program did not start.')
    await page.clock.runFor(300_000)
    await expect(notice(page)).toBeVisible()
    await notice(page).locator('.notice-dismiss').click()
    await expect(notice(page)).toHaveCount(0)
  })

  for (const { locale, opened, copied, refused } of [
    {
      locale: 'en',
      opened: (name: string) => `Session ${name} opened in VS Code`,
      copied: (name: string) => `Command for session ${name} copied — paste it into a terminal`,
      refused: (name: string) => `Session ${name}: The program did not start.`,
    },
    {
      locale: 'ru',
      opened: (name: string) => `Сессия ${name} открыта в VS Code`,
      copied: (name: string) => `Команда для сессии ${name} скопирована — вставьте её в терминал`,
      refused: (name: string) => `Сессия ${name}: Программа не запустилась.`,
    },
  ] as const) {
    test(`it says which session, in the button's words and to a screen reader (${locale})`, async ({
      page,
    }) => {
      const button = await openInApp(page, answerToPress, locale)
      const name = (await button.locator('.open-action-name').textContent()) ?? ''
      const region = page.locator('#app > [role="status"]')

      await button.click()
      await expect(notice(page).locator('.notice-message')).toHaveText(opened(name))
      await expect(region).toHaveText(opened(name))

      await appAnswers(page, {
        ok: true,
        mode: 'copied',
        command: `claude --resume ${IN_VSCODE}`,
        next: null,
        plan: desktopPlan,
      })
      await button.click()
      await expect(notice(page).locator('.notice-message')).toHaveText(copied(name))
      await expect(region).toHaveText(copied(name))

      await appAnswers(page, {
        ok: false,
        mode: 'refused',
        reason: 'launch-failed',
        next: null,
        plan: desktopPlan,
      })
      await button.click()
      await expect(notice(page).locator('.notice-message')).toHaveText(refused(name))
      await expect(region).toHaveText(refused(name))
    })
  }
})
