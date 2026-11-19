/**
 * Closing work and putting it off from its card, in the built application.
 *
 * A move that closes work or puts it off is not sent as it is chosen from the state's menu:
 * putting off asks until when and why in a window, a task's cancel asks its reason in place,
 * and a goal's cancel lists what closes with it first. That list is the server's: when the work
 * under the goal changed between reading it and pressing, the server refuses again with the new
 * list, and the window shows it, marked, and asks again. A goal awaiting confirmation is
 * confirmed against its conditions or its description, and a step a former holder marked is
 * confirmed beside its mark.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import type { BackendOptions } from './backend.ts'
import { spaceRef, spaceScope, workItem, workItemRef } from './planningFixtures.ts'
import {
  CHANGED_LIST,
  closingSpace,
  CONDITIONS,
  conditionsGoal,
  deferredCard,
  descriptionGoal,
  FIRST_LIST,
  goalCard,
  markedCard,
} from './served/closing.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: spaceScope,
  entity: planningWorkItemEntity(workItemRef),
})
const shot = (path: string) => ({ path, animations: 'disabled' as const })
type Sent = Record<string, unknown>

async function openCard(page: Page, width: number, options: BackendOptions) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, options)
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  // The drawer slides in: measured on its way, it stands past the window's edge.
  await page.waitForFunction(() =>
    document.getAnimations().every(({ playState }) => playState !== 'running'),
  )
  return drawer
}

/** Every write to `path`, in order, each answered as `answer` says for its place. */
async function writes(
  page: Page,
  path: string,
  answer: (index: number) => { json?: object; status?: number } = () => ({}),
) {
  const sent: Sent[] = []
  await page.route(`**${path}`, async (route) => {
    sent.push(route.request().postDataJSON() as Sent)
    const { status = 200, json = {} } = answer(sent.length - 1)
    await route.fulfill({ status, json })
  })
  return sent
}

async function openStateMenu(page: Page, drawer: Locator) {
  await drawer.locator('.card-facts .card-state').first().click()
  return page.getByRole('listbox')
}

/** Nothing on the page is wider than the window, and `box` stands inside it. */
async function fitsWindow(page: Page, box: Locator) {
  const width = page.viewportSize()?.width ?? 0
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const rect = await box.boundingBox()
  expect(rect?.x).toBeGreaterThanOrEqual(0)
  expect((rect?.x ?? 0) + (rect?.width ?? 0)).toBeLessThanOrEqual(width)
}

for (const width of [1280, 390]) {
  test(`a task is cancelled with its reason, asked in place, at ${width}px`, async ({
    page,
  }, info) => {
    const drawer = await openCard(page, width, { space: closingSpace })
    const sent = await writes(page, '/api/planning/work-item/apply')
    await openStateMenu(page, drawer)
    await page.getByRole('option', { name: 'Dropped' }).click()

    const strip = drawer.locator('[data-closing="cancel-task"]')
    await expect(strip.getByRole('textbox')).toBeFocused()
    await expect(strip).toContainText('Cancel MAIN-264? The card closes as «Dropped».')
    const press = strip.getByRole('button', { name: 'Cancel task' })
    await press.click()
    await expect(strip.getByRole('alert')).toHaveText('Say why it is cancelled.')
    expect(sent).toEqual([])

    await strip.getByRole('textbox').fill('Duplicate of MAIN-265')
    await expect(strip.getByRole('alert')).toBeHidden()
    await fitsWindow(page, strip)
    await drawer.screenshot(shot(info.outputPath(`confirm-${width}-cancel-task.png`)))
    await press.click()
    await expect.poll(() => sent.length).toBe(1)
    expect(sent[0]).toMatchObject({
      id: workItemRef.reference,
      summary: { next: 'Nothing: it was cancelled.', why: 'Duplicate of MAIN-265' },
      transition: { state: 'dropped', reason: 'Duplicate of MAIN-265' },
    })
    await expect(strip).toHaveCount(0)
  })
}

for (const width of [1280, 620, 390]) {
  test(`a task is put off until a day, and its card says until when, at ${width}px`, async ({
    page,
  }, info) => {
    let deferred = false
    const drawer = await openCard(page, width, {
      space: closingSpace,
      card: (read) => (deferred ? deferredCard(read) : read),
    })
    const sent = await writes(page, '/api/planning/work-item/defer', () => {
      deferred = true
      return {}
    })
    await openStateMenu(page, drawer)
    await page.getByRole('option', { name: 'Later' }).click()

    const dialog = page.getByRole('dialog', { name: 'Put off' })
    const press = dialog.locator('button[type="submit"]')
    await expect(press).toBeDisabled()
    await dialog.getByLabel('Until a day').fill('2099-01-02')
    await expect(press).toBeDisabled()
    await dialog.getByLabel('Why it waits').fill('After the release')
    await expect(press).toBeEnabled()
    await fitsWindow(page, dialog)
    await page.screenshot(shot(info.outputPath(`dialogs-${width}-defer-date.png`)))
    await press.click()
    await expect
      .poll(() => sent)
      .toEqual([
        {
          author: 'user',
          id: workItemRef.reference,
          until: '2099-01-02',
          reason: 'After the release',
        },
      ])
    await expect(dialog).toBeHidden()
    await expect(drawer.locator('[data-hindrance="deferred"]')).toHaveText(
      'Put off until January 2 — After the release',
    )
  })
}

test('a task is put off until a card of its space closes', async ({ page }, info) => {
  const drawer = await openCard(page, 1280, { space: closingSpace })
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: 'api',
        limit: 50,
        has_more: false,
        items: [
          {
            target: { space_ref: spaceRef, reference: 'MAIN-41', writable: true },
            item: {
              work_item_id: '00000000-0000-4000-8000-000000000241',
              planning_space_id: workItem.planning_space_id,
              reference: 'MAIN-41',
              title: 'API contract',
              state: { name: 'Dev' },
              open: true,
              container_state: null,
              claim_ref: '',
            },
          },
        ],
        coverage: [{ space_ref: spaceRef, status: 'searched', reason: null }],
      },
    }),
  )
  const sent = await writes(page, '/api/planning/work-item/defer')
  await openStateMenu(page, drawer)
  await page.getByRole('option', { name: 'Later' }).click()
  const dialog = page.getByRole('dialog', { name: 'Put off' })
  await dialog.getByRole('combobox', { name: 'Until a card closes' }).fill('api')
  await page.getByRole('option', { name: 'MAIN-41 API contract' }).click()
  await dialog.getByLabel('Why it waits').fill('Waits on the contract')
  await page.screenshot(shot(info.outputPath('dialogs-1280-defer-card.png')))
  await dialog.locator('button[type="submit"]').click()
  await expect
    .poll(() => sent)
    .toEqual([
      {
        author: 'user',
        id: workItemRef.reference,
        until: 'MAIN-41',
        reason: 'Waits on the contract',
      },
    ])
})

for (const width of [1280, 620, 390]) {
  test(`a goal's cancel shows what closes, and asks again when that changed, at ${width}px`, async ({
    page,
  }, info) => {
    const drawer = await openCard(page, width, {
      space: closingSpace,
      card: goalCard('in_progress'),
    })
    const lists = [FIRST_LIST, CHANGED_LIST]
    const sent = await writes(page, '/api/planning/work-item/apply', (index) =>
      index < lists.length ? { status: 409, json: lists[index] } : {},
    )
    const menu = await openStateMenu(page, drawer)
    await expect(menu.getByRole('option')).toHaveText(['In progress', 'Put off…', 'Cancel…'])
    await page.screenshot(shot(info.outputPath(`confirm-${width}-state-menu.png`)))
    await page.getByRole('option', { name: 'Cancel…' }).click()

    const dialog = page.getByRole('dialog', { name: 'Cancel goal' })
    const press = dialog.locator('button[type="submit"]')
    const rows = dialog.locator('.cancel-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('held by worker-a')
    await expect(rows.nth(2)).toContainText('waits on MAIN-272')
    await expect(press).toHaveText('Cancel 2 cards')
    await fitsWindow(page, dialog)
    await page.screenshot(shot(info.outputPath(`dialogs-${width}-cancel-goal-list.png`)))

    await dialog.getByLabel('Reason').fill('The plan changed')
    await press.click()
    await expect(dialog.locator('.cancel-changed')).toContainText('The list changed')
    await expect(dialog.locator('[data-change="changed"]')).toHaveAttribute(
      'data-reference',
      'MAIN-272',
    )
    await expect(dialog.locator('[data-change="new"]')).toHaveAttribute(
      'data-reference',
      'MAIN-274',
    )
    await expect(dialog.locator('[data-change]')).toHaveCount(2)
    await expect(press).toHaveText('Cancel 3 cards')
    await fitsWindow(page, dialog)
    await page.screenshot(shot(info.outputPath(`dialogs-${width}-cancel-goal-changed.png`)))

    await press.click()
    await expect(dialog).toBeHidden()
    const transitions = sent.map((body) => body.transition as Sent)
    expect(transitions).toEqual([
      { state: 'dropped' },
      { state: 'dropped', reason: 'The plan changed', cancels: FIRST_LIST.error.list_token },
      { state: 'dropped', reason: 'The plan changed', cancels: CHANGED_LIST.error.list_token },
    ])
    expect(sent[2]).toMatchObject({ summary: { why: 'The plan changed' } })
  })
}

for (const width of [1280, 620, 390]) {
  test(`a goal awaiting confirmation is confirmed against its conditions at ${width}px`, async ({
    page,
  }, info) => {
    const drawer = await openCard(page, width, { space: closingSpace, card: conditionsGoal })
    const sent = await writes(page, '/api/planning/work-item/apply')
    await drawer.locator('[data-closing="confirm"]').click()

    const dialog = page.getByRole('dialog', { name: 'Confirm close' })
    const press = dialog.locator('button[type="submit"]')
    await expect(dialog.locator('.confirm-closed-row')).toHaveText([
      'MAIN-270Cancelled · Reason: Not needed: the tray covers it',
      'MAIN-271Moved out',
    ])
    await expect(press).toBeDisabled()
    await dialog.getByRole('checkbox', { name: CONDITIONS[1].text }).click()
    await expect(press).toBeEnabled()
    await fitsWindow(page, dialog)
    // Each box stands on its condition's first line, as the card's checklist box does.
    const offsets = await dialog.locator('.confirm-step').evaluateAll((rows) =>
      rows.map((row) => {
        const box = row.querySelector('.step-mark')?.getBoundingClientRect()
        const text = row.querySelector('.confirm-step-text')
        if (!box || !text) return Number.POSITIVE_INFINITY
        const line = Number.parseFloat(getComputedStyle(text).lineHeight)
        return Math.abs(box.top + box.height / 2 - (text.getBoundingClientRect().top + line / 2))
      }),
    )
    expect(offsets).toHaveLength(CONDITIONS.length)
    for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1)
    await page.screenshot(shot(info.outputPath(`dialogs-${width}-confirm-close-conditions.png`)))
    await press.click()
    await expect(dialog).toBeHidden()
    expect(sent).toEqual([
      {
        author: 'user',
        id: workItemRef.reference,
        checklist_ticks: [CONDITIONS[1], CONDITIONS[2]].map(({ id }) => ({
          item_id: id,
          done: true,
        })),
        summary: {
          done: 'Confirmed by the owner: all work under it is closed.',
          next: 'Nothing: the work under it is closed.',
        },
        transition: { state: 'done' },
      },
    ])
  })
}

for (const width of [1280, 390]) {
  test(`a goal without conditions is confirmed against its description at ${width}px`, async ({
    page,
  }, info) => {
    const drawer = await openCard(page, width, { space: closingSpace, card: descriptionGoal })
    const sent = await writes(page, '/api/planning/work-item/apply')
    await drawer.locator('[data-closing="confirm"]').click()
    const dialog = page.getByRole('dialog', { name: 'Confirm close' })
    await expect(dialog.locator('[data-part="description"]')).toContainText(
      'No conditions: it is checked against its description',
    )
    await expect(dialog.locator('[data-part="description"]')).toContainText(
      'Every channel delivers the same alert once.',
    )
    await fitsWindow(page, dialog)
    await page.screenshot(shot(info.outputPath(`dialogs-${width}-confirm-close-none.png`)))
    await dialog.locator('button[type="submit"]').click()
    await expect.poll(() => sent.length).toBe(1)
    expect(sent[0]).not.toHaveProperty('checklist_ticks')
    expect(sent[0]).toMatchObject({ transition: { state: 'done' } })
  })

  test(`a step its former holder marked is confirmed beside its mark at ${width}px`, async ({
    page,
  }, info) => {
    const drawer = await openCard(page, width, { card: markedCard })
    const ticks: Sent[] = []
    await page.route('**/api/planning/work-item/checklist/tick', async (route) => {
      ticks.push(route.request().postDataJSON() as Sent)
      await route.abort()
    })
    const row = drawer.locator('.step-row').filter({ hasText: CONDITIONS[2].text })
    await expect(row.locator('[data-mark="by-previous-holder"]')).toBeVisible()
    const confirm = row.getByRole('button', { name: `Confirm the step ${CONDITIONS[2].text}` })
    await fitsWindow(page, confirm)
    // The holder's line never wraps: what stands in it must leave the holder's name its room.
    const holder = row.locator('.step-holder')
    expect(
      await holder.evaluate((line) => line.scrollWidth - line.clientWidth),
    ).toBeLessThanOrEqual(1)
    await row.screenshot(shot(info.outputPath(`confirm-${width}-mark.png`)))
    await confirm.click()
    await expect
      .poll(() => ticks)
      .toEqual([
        { author: 'user', id: workItemRef.reference, item_id: CONDITIONS[2].id, done: true },
      ])
  })
}
