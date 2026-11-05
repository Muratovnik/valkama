import { expect } from '@playwright/test'
import type { Page, Request } from '@playwright/test'

import type { AlertPresence } from '@/shared/api/alertsApi.ts'
import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { ALERT_SETTINGS, installAlerts, READINESS_CASES } from './alertsFixtures.ts'
import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: projectScope })
const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })
const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

async function openAlerts(page: Page) {
  await page.goto(SETTINGS)
  await expect(page.getByRole('heading', { name: 'Windows notifications' })).toBeVisible()
  await expect(
    page.getByRole('switch', { name: 'Notify me when an agent is waiting for me' }),
  ).toBeVisible()
}

const readiness = (page: Page) => page.locator('.settings-alerts-readiness')
const boxes = (page: Page) => page.locator('.settings-alerts-events').getByRole('checkbox')

const presenceOf = (request: Request) => request.postDataJSON() as AlertPresence
const isPresence = (request: Request) =>
  request.method() === 'POST' && new URL(request.url()).pathname === '/api/alerts/presence'

for (const { name, status, word } of READINESS_CASES)
  test(`readiness "${name}" says what it is and fits both widths`, async ({ page }) => {
    await installBackend(page)
    await installAlerts(page, { status })
    await page.setViewportSize({ width: 1280, height: 900 })
    await openAlerts(page)
    await expect(readiness(page)).toContainText(word)
    await expectNoSilentClipping(page, `Readiness ${name} at 1280px`)

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(readiness(page)).toContainText(word)
    await expectNoSilentClipping(page, `Readiness ${name} at 390px`)
  })

test('the longest Russian words fit a phone, in the readiness row and after a refused test', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  await installBackend(page)
  await installAlerts(page, {
    status: READINESS_CASES.find(({ name }) => name === 'disabled-for-application')?.status,
    test: {
      ...READINESS_CASES.find(({ name }) => name === 'helper-unavailable')?.status.windows,
      shown: false,
    },
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(SETTINGS)
  await expect(readiness(page)).toContainText('Windows отключила оповещения Valkama')
  await page.getByRole('button', { name: 'Отправить проверочное' }).click()
  await expect(page.locator('.settings-alerts-failure')).toContainText('Проверка не удалась')
  await expectNoSilentClipping(page, 'Russian alerts at 390px')
})

test('the whole group answers to the keyboard, and keeps focus through every press', async ({
  page,
}) => {
  await installBackend(page)
  const alerts = await installAlerts(page)
  await page.setViewportSize({ width: 1280, height: 1000 })
  await openAlerts(page)

  const toggle = page.getByRole('switch', { name: 'Notify me when an agent is waiting for me' })
  await toggle.focus()

  // The switch writes, keeps focus, and leaves the boxes out of the Tab order while off.
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toBeFocused()
  await expect.poll(() => alerts.writes.at(-1)).toMatchObject({ enabled: false })
  await page.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toBeFocused()
  await expect
    .poll(() => alerts.writes.at(-1))
    .toMatchObject({
      enabled: true,
      events: ALERT_SETTINGS.events,
    })

  await page.keyboard.press('Tab')
  await expect(boxes(page).nth(0)).toBeFocused()
  await page.keyboard.press('Space')
  await expect(boxes(page).nth(0)).not.toBeChecked()
  await expect(boxes(page).nth(0)).toBeFocused()
  await expect.poll(() => alerts.writes.at(-1)).toMatchObject({ events: { question: false } })
  await page.keyboard.press('Tab')
  await expect(boxes(page).nth(1)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(boxes(page).nth(2)).toBeFocused()

  await page.keyboard.press('Tab')
  const content = page.getByRole('combobox', { name: 'What to show' })
  await expect(content).toBeFocused()
  await expect(content).toHaveText(/Work item number and title/)
  await page.keyboard.press('Enter')
  await page.getByRole('option', { name: 'Number, title and the question' }).focus()
  await page.keyboard.press('Enter')
  await expect(content).toHaveText(/Number, title and the question/)
  await expect(content).toBeFocused()
  await expect.poll(() => alerts.writes.at(-1)).toMatchObject({ content: 'prompt' })

  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Check again' })).toBeFocused()
  await page.keyboard.press('Tab')
  const send = page.getByRole('button', { name: 'Send a test notification' })
  await expect(send).toBeFocused()
  expect(await send.evaluate((node) => node.matches(':focus-visible'))).toBe(true)
  await page.keyboard.press('Enter')
  await expect(page.locator('.settings-alerts-detail[role="status"]')).toContainText('Sent to')
  await expect(send).toBeFocused()
  expect(alerts.testsSent()).toBe(1)
})

test('a refused write stands beside its row and the old value comes back', async ({ page }) => {
  await installBackend(page)
  await installAlerts(page, {
    refuseWrite: {
      status: 400,
      body: { error: { code: 'refused', message: 'the store is full' } },
    },
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await openAlerts(page)

  await boxes(page).nth(1).click()
  await expect(page.getByRole('alert')).toHaveText('Not saved: the store is full')
  await expect(boxes(page).nth(1)).toBeChecked()
  await expectNoSilentClipping(page, 'A refused write at 390px')
})

for (const colorScheme of ['light', 'dark'] as const)
  test(`in the ${colorScheme} forced palette the controls stay controls and the switch says which way it is thrown`, async ({
    page,
  }) => {
    await installBackend(page)
    await installAlerts(page)
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    await page.setViewportSize({ width: 1280, height: 900 })
    await openAlerts(page)

    const toggle = page.getByRole('switch', { name: 'Notify me when an agent is waiting for me' })
    const paint = () =>
      toggle.evaluate((node) => {
        const track = getComputedStyle(node.querySelector('.toggle-track') as Element)
        const knob = getComputedStyle(node.querySelector('.toggle-knob') as Element)
        return {
          track: track.backgroundColor,
          knob: knob.backgroundColor,
          page: getComputedStyle(document.body).backgroundColor,
        }
      })

    const on = await paint()
    expect(on.knob).not.toBe(on.track)
    expect(on.track).not.toBe(on.page)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    // The fills ease from one to the other, so the switch is read once it has come to rest.
    await expect
      .poll(async () => {
        const { track } = await paint()
        return track
      })
      .not.toBe(on.track)
    const off = await paint()
    expect(off.knob).not.toBe(off.track)

    const outlined = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((node) => getComputedStyle(node).outlineStyle)
    expect(await outlined('.settings-alerts-test')).toBe('solid')
    expect(await outlined('.settings-alerts-control .choice-trigger')).toBe('solid')
  })

test('a page reports the open card by its id and the open list, then that neither is', async ({
  page,
}) => {
  await installBackend(page)
  await installAlerts(page)
  await page.setViewportSize({ width: 1280, height: 900 })

  const heard: AlertPresence[] = []
  page.on('request', (request) => {
    if (isPresence(request)) heard.push(presenceOf(request))
  })

  await page.goto(CARD)
  await expect(page.locator('.drawer .card-facts')).toBeVisible()
  await expect
    .poll(() => heard.at(-1))
    .toMatchObject({ focused: true, hub_open: false, work_item_id: workItem.work_item_id })

  await page.getByRole('button', { name: 'Close' }).first().click()
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect.poll(() => heard.at(-1)?.work_item_id).toBeNull()

  await page.goto(BOARD)
  await page.getByRole('button', { name: /^Needs my answer/ }).click()
  await expect.poll(() => heard.at(-1)?.hub_open).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => heard.at(-1)?.hub_open).toBe(false)
})

test('leaving the planning module says no card is open', async ({ page }) => {
  await installBackend(page)
  await installAlerts(page)
  const heard: AlertPresence[] = []
  page.on('request', (request) => {
    if (isPresence(request)) heard.push(presenceOf(request))
  })

  await page.goto(CARD)
  await expect.poll(() => heard.at(-1)?.work_item_id).toBe(workItem.work_item_id)

  // With a card open the drawer covers the rail, so an address is what leaves from here.
  await page.evaluate((to) => {
    history.pushState({}, '', to)
    dispatchEvent(new PopStateEvent('popstate'))
  }, SETTINGS)
  await expect(page.locator('.settings-page')).toBeVisible()
  await expect.poll(() => heard.at(-1)?.work_item_id).toBeNull()
})

test('settings stored with the old notify fields open cleanly and lose them', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem(
      'valkama-settings',
      JSON.stringify({
        notifyEnabled: false,
        notify: { itemCompleted: false, agentWaiting: true },
        openers: { codex: { kind: 'custom', command: 'wt {cwd}' } },
      }),
    )
  })
  await installBackend(page)
  await installAlerts(page)
  await openAlerts(page)

  expect(errors).toEqual([])
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('valkama-settings') ?? '{}'),
  )
  expect(stored).not.toHaveProperty('notify')
  expect(stored).not.toHaveProperty('notifyEnabled')
  // The old opener reads as the place it named, and the owner's command stays theirs.
  expect(stored).not.toHaveProperty('openers')
  expect(stored.sessions.codex).toEqual({
    fallback: 'vscode',
    always: 'custom',
    command: 'wt {cwd}',
  })
})
