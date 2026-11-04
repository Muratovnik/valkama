/**
 * The way from a card to a session, in the real app with the plan's route answered: the
 * keyboard reaches every holder in reading order, a panel holds focus and Escape gives it
 * back, and each width and language keeps the place in view. `window.open` is recorded,
 * so no test starts anything outside the browser.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { shot } from './boardPage.ts'
import {
  CRASHED,
  DESKTOP_LINK,
  finishedCard,
  FOLDER_LINK,
  heldCard,
  IN_VSCODE,
  openPlanFor,
  RESUME_COMMAND,
  SESSION_LINK,
  threeAgents,
  UNLINKED_SESSION,
} from './openSessionFixtures.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { globalScope, projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

interface Opening {
  always?: string
  closed?: boolean
  locale?: 'en' | 'ru'
  width?: number
}

async function openCard(page: Page, { always, closed, locale = 'en', width = 1280 }: Opening = {}) {
  await page.setViewportSize({ width, height: 1500 })
  await page.addInitScript(
    ({ always: place, language }) => {
      localStorage.setItem('valkama-locale', language)
      if (place)
        localStorage.setItem(
          'valkama-settings',
          JSON.stringify({ sessions: { claude: { fallback: 'vscode', always: place } } }),
        )
    },
    { always, language: locale },
  )
  await installBackend(page, {
    agents: threeAgents,
    card: closed ? finishedCard : heldCard,
    closedWith: closed ? 'It is done.' : undefined,
    openPlan: openPlanFor,
  })
  await page.goto(CARD)
  await expect(page.locator('.drawer .card-holder button.open-action')).toBeVisible()
}

const openedLinks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened ?? [])

/** Tab until the control has focus, as a reader does, failing if the pass runs out. */
async function tabTo(page: Page, control: Locator, limit = 60) {
  for (let presses = 0; presses < limit; presses += 1) {
    await page.keyboard.press('Tab')
    if (await control.evaluate((node) => node === document.activeElement)) return presses + 1
  }
  throw new Error('the control was not reached from the keyboard')
}

test('the keyboard reaches the holder, the steps and the agents, in reading order', async ({
  page,
}) => {
  await openCard(page)
  const head = page.locator('.drawer .card-holder button.open-action')
  await tabTo(page, head)
  const step = page.locator('.step-holder button.open-action').first()
  await tabTo(page, step)
  const agents = page.locator('.drawer .agents button.open-action')
  await expect(agents).toHaveCount(2)
  await tabTo(page, agents.first())
  await page.keyboard.press('Tab')
  await expect(agents.nth(1)).toBeFocused()
})

test('a session with one action opens on Enter or Space, and the result is said', async ({
  page,
}) => {
  await openCard(page)
  const desktop = page.locator('.drawer .agents button.open-action').nth(1)
  await desktop.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => openedLinks(page)).toEqual([DESKTOP_LINK])
  await expect(
    page.locator('.app-notice, [role="status"]').getByText('Opened in Claude Desktop'),
  ).toBeVisible()
  await expect(desktop).toBeFocused()

  await page.keyboard.press('Space')
  await expect.poll(() => openedLinks(page)).toEqual([DESKTOP_LINK, DESKTOP_LINK])
})

test('two steps stand in order, the second after the first, and focus goes with them', async ({
  page,
}) => {
  await openCard(page)
  await page.locator('.drawer .card-holder button.open-action').click()
  const panel = page.getByRole('dialog', { name: 'Open session' })
  const first = panel.getByRole('button', { name: 'Open the project window in VS Code' })
  const second = panel.getByRole('button', { name: 'Open the session in VS Code' })
  await expect(first).toBeFocused()
  await expect(second).toBeDisabled()
  expect(await openedLinks(page)).toEqual([])

  await page.keyboard.press('Enter')
  await expect(second).toBeFocused()
  await expect.poll(() => openedLinks(page)).toEqual([FOLDER_LINK])
  await expect(panel.locator('[role="status"]')).toContainText('Now open the session in it.')

  await page.keyboard.press('Enter')
  await expect(panel).toBeHidden()
  await expect.poll(() => openedLinks(page)).toEqual([FOLDER_LINK, SESSION_LINK])
  await expect(page.getByRole('status').filter({ hasText: 'Opened in VS Code' })).toHaveCount(1)
  await expect(page.locator('.drawer .card-holder button.open-action')).toBeFocused()
})

test('Escape closes the panel of a running session and gives focus back to its button', async ({
  page,
}) => {
  await openCard(page)
  const button = page
    .locator('.step-holder')
    .getByRole('button', { name: /running in a terminal/u })
    .first()
  await tabTo(page, button)
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'The session is running' })
  await expect(panel).toContainText('a second copy would write to the same session')
  await expect(panel).toContainText('See it in VS Code')
  const first = panel.getByRole('button', { name: 'Open the project window in VS Code' })
  await expect(first).toBeFocused()

  // The panel keeps Tab inside it while it stands.
  for (let presses = 0; presses < 5; presses += 1) {
    await page.keyboard.press('Tab')
    expect(await panel.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(button).toBeFocused()
  // The card it stood over is still there, and nothing ran.
  await expect(page.locator('.drawer .card-holder')).toBeVisible()
  expect(await openedLinks(page)).toEqual([])
})

test('a session long silent warns first, and resumes only on its own press', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openCard(page)
  const fromStep = page.locator(`.step-holder button.open-action[title*="${CRASHED}"]`)
  await fromStep.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'The session is running' })
  await expect(panel).toContainText('Last sign of it:')
  await expect(panel).toContainText('It may have crashed')
  await expect(panel).toContainText('a second process would write to the same transcript')
  const resume = panel.getByRole('button', { name: 'Copy the command, if the window is closed' })
  await expect(resume).toBeVisible()
  // Focus stands on the way to look at it, and walking those steps never reaches the offer.
  await expect(
    panel.getByRole('button', { name: 'Open the project window in VS Code' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(panel).toBeHidden()
  await expect.poll(() => openedLinks(page)).toEqual([FOLDER_LINK, SESSION_LINK])
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toBe(RESUME_COMMAND)

  await fromStep.focus()
  await page.keyboard.press('Enter')
  await resume.click()
  await expect(panel).toBeHidden()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(RESUME_COMMAND)
  await expect(page.getByRole('status').filter({ hasText: 'Command copied' })).toHaveCount(1)
})

test('a reason with nothing to press is reachable from the keyboard', async ({ page }) => {
  await openCard(page)
  const why = page.locator('.step-holder .open-action-why').first()
  await tabTo(page, why)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tooltip')).toContainText('The client no longer has this session.')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toBeHidden()
  await expect(why).toBeFocused()
})

test('with "always open in" on, the head says where and that the setting chose it', async ({
  page,
}) => {
  await openCard(page, { always: 'cursor' })
  const head = page.locator('.drawer .card-holder button.open-action')
  await expect(head).toContainText('Cursor · running · by your setting')
  await expect(head).toHaveAttribute('aria-label', /in Cursor — by your setting/u)
})

test('on finished work whoever last held it is the way back to the session', async ({ page }) => {
  await openCard(page, { closed: true })
  const past = page.locator('.drawer .card-holder')
  await expect(past).toContainText('Previously responsible')
  await expect(past.getByRole('button')).toHaveAttribute(
    'aria-label',
    new RegExp(IN_VSCODE.slice(0, 8), 'u'),
  )
})

test('the card with its holders passes the accessibility rules, panel open or not', async ({
  page,
}) => {
  await openCard(page)
  const rules = ['color-contrast', 'button-name', 'aria-allowed-attr']
  const closed = await new AxeBuilder({ page }).include('.drawer').withRules(rules).analyze()
  expect(closed.violations).toEqual([])
  await page.locator('.drawer .card-holder button.open-action').click()
  await expect(page.locator('.open-panel')).toBeVisible()
  // Contrast is read off what stands, and a fade is on its way there.
  await settled(page)
  const open = await new AxeBuilder({ page }).include('.open-panel').withRules(rules).analyze()
  expect(open.violations).toEqual([])
})

for (const locale of ['en', 'ru'] as const)
  for (const width of [1280, 390]) {
    test(`the card reads whole at ${width}px in ${locale}`, async ({ page }, info) => {
      await openCard(page, { locale, width })
      await expectNoSilentClipping(page, `card at ${width}px in ${locale}`)
      await page.screenshot(shot(info, `card-${locale}-${width}.png`))

      await page.locator('.drawer .card-holder button.open-action').click()
      await expect(page.locator('.open-panel')).toBeVisible()
      await settled(page)
      await page.screenshot(shot(info, `panel-${locale}-${width}.png`))
      await page.keyboard.press('Escape')

      await page.locator('.step-holder button.open-action').nth(1).click()
      await expect(page.locator('.open-panel-why').first()).toBeVisible()
      await settled(page)
      await page.screenshot(shot(info, `running-${locale}-${width}.png`))
      await page.keyboard.press('Escape')

      await page.locator(`.step-holder button.open-action[title*="${CRASHED}"]`).click()
      await expect(page.locator('.open-panel-offer')).toBeVisible()
      await expectNoSilentClipping(page, `silent panel at ${width}px in ${locale}`)
      await settled(page)
      await page.screenshot(shot(info, `silent-${locale}-${width}.png`))
      await page.keyboard.press('Escape')

      const drawer = page.locator('.drawer')
      await drawer.getByRole('radio', { name: /^(Execution|Исполнение)$/u }).click()
      await expect(page.locator('.drawer .attempt-sessions button.open-action')).toBeVisible()
      await expectNoSilentClipping(page, `attempts at ${width}px in ${locale}`)
      await page.screenshot(shot(info, `attempts-${locale}-${width}.png`))
      await drawer.getByRole('radio', { name: /^(Relations|Связи)$/u }).click()
      await expect(page.locator('.drawer .ref-session button.open-action')).toBeVisible()
      await expectNoSilentClipping(page, `links at ${width}px in ${locale}`)
      await page.screenshot(shot(info, `links-${locale}-${width}.png`))
    })

    test(`"always open in" reads whole at ${width}px in ${locale}`, async ({ page }, info) => {
      await openCard(page, { always: 'vscode-insiders', locale, width })
      await expect(page.locator('.drawer .card-holder')).toContainText(
        locale === 'en' ? 'by your setting' : 'по настройке',
      )
      await expectNoSilentClipping(page, `always at ${width}px in ${locale}`)
      await page.screenshot(shot(info, `always-${locale}-${width}.png`))
    })

    test(`finished work reads whole at ${width}px in ${locale}`, async ({ page }, info) => {
      await openCard(page, { closed: true, locale, width })
      await expect(page.locator('.drawer .card-holder')).toContainText(
        locale === 'en' ? 'Previously responsible' : 'Ранее отвечал',
      )
      await expectNoSilentClipping(page, `finished at ${width}px in ${locale}`)
      await page.screenshot(shot(info, `finished-${locale}-${width}.png`))
    })

    test(`the session dialog reads whole at ${width}px in ${locale}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 800 })
      await page.addInitScript((value) => localStorage.setItem('valkama-locale', value), locale)
      await installBackend(page, { openPlan: openPlanFor })
      await page.goto(
        serializePlatformRoute({
          module_id: 'sessions',
          scope: globalScope,
          entity: { kind: 'session', session_id: UNLINKED_SESSION, client_family: 'claude' },
        }),
      )
      const dialog = page.getByRole('dialog').last()
      await expect(dialog.locator('button.open-action')).toContainText('Claude Desktop')
      await settled(page)
      await page.screenshot(shot(info, `dialog-${locale}-${width}.png`))
      await expect(dialog.locator('button.open-action')).toBeVisible()
    })
  }

for (const colorScheme of ['dark', 'light'] as const)
  for (const width of [1280, 390])
    test(`a forced palette paints every holder at ${width}px, ${colorScheme}`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme, forcedColors: 'active' })
      await openCard(page, { width })
      await page.screenshot(shot(info, `forced-${colorScheme}-${width}.png`))
      for (const control of [
        page.locator('.drawer .card-holder button.open-action'),
        page.locator('.step-holder .open-action-still').first(),
      ])
        expect(await paintedPixels(page, control)).toBeGreaterThan(40)
      await page.locator('.drawer .card-holder button.open-action').click()
      await expect(page.locator('.open-panel')).toBeVisible()
      await settled(page)
      await page.screenshot(shot(info, `forced-panel-${colorScheme}-${width}.png`))
      await page.keyboard.press('Escape')
      await page.locator(`.step-holder button.open-action[title*="${CRASHED}"]`).click()
      const resume = page.locator('.open-panel-resume')
      await expect(resume).toBeVisible()
      await settled(page)
      await page.screenshot(shot(info, `forced-silent-${colorScheme}-${width}.png`))
      expect(await paintedPixels(page, resume)).toBeGreaterThan(40)
    })

/**
 * Waits until what a shot or a contrast rule reads has stopped moving: an overlay is in
 * the document a frame before its fade starts, and a shot in that frame has no overlay.
 */
async function settled(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    await Promise.all(document.getAnimations().map((animation) => animation.finished))
  })
}

/**
 * How many pixels of a control are not its ground, in the picture itself: a forced
 * palette can clear what a computed style still reports. Read on a blank page, since the
 * app's own policy refuses an image from data.
 */
async function paintedPixels(page: Page, control: Locator): Promise<number> {
  const picture = await control.screenshot()
  const png = picture.toString('base64')
  const blank = await page.context().newPage()
  const count = await blank.evaluate(async (source) => {
    const picture = new Image()
    picture.src = `data:image/png;base64,${source}`
    await picture.decode()
    const surface = new OffscreenCanvas(picture.width, picture.height)
    const paint = surface.getContext('2d')
    paint?.drawImage(picture, 0, 0)
    const { data } = paint?.getImageData(0, 0, picture.width, picture.height) ?? { data: [] }
    let different = 0
    for (let at = 0; at < data.length; at += 4)
      if (
        Math.abs((data[at] ?? 0) - (data[0] ?? 0)) +
          Math.abs((data[at + 1] ?? 0) - (data[1] ?? 0)) +
          Math.abs((data[at + 2] ?? 0) - (data[2] ?? 0)) >
        96
      )
        different += 1
    return different
  }, png)
  await blank.close()
  return count
}
