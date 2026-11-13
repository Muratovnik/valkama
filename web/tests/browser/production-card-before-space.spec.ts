/**
 * A card opened by its address stands before its space is read.
 *
 * The space is every item it holds and reads in a fraction of a second on a big store, the
 * card in a tenth of that, and the drawer used to wait for the space before it even asked for
 * the card. Here the space answers only once the test lets it, after the card's title and its
 * description are on screen, and what the card takes from the space — the parent's reference and
 * the states it may move to — comes in afterwards into places already held for it, so nothing
 * on the card moves or blinks when the space answers.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { blockedWorkItem, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The card's item in an epic: its record names the parent by id, the space by reference. */
const inEpic = (model: Record<string, unknown>) => ({
  ...model,
  work_items: (model.work_items as { work_item_id: string }[]).map((item) =>
    item.work_item_id === workItem.work_item_id
      ? { ...item, parent_id: blockedWorkItem.work_item_id }
      : item,
  ),
})

/**
 * The space's read, held until `release`; `answered` is set as it goes on to its answer.
 *
 * Held for a fixed two seconds, it answered before the watch began whenever the card's own
 * code took that long to arrive, and the parent's row was there in the first frame watched.
 */
async function lateSpace(page: Page) {
  const late = { answered: false, release: () => {} }
  const held = new Promise<void>((done) => {
    late.release = done
  })
  await page.route('**/api/planning?*', async (route) => {
    await held
    late.answered = true
    await route.fallback()
  })
  return late
}

interface Sample {
  description: boolean
  descriptionTop: number
  factsBottom: number
  parentLink: boolean
  parentRow: boolean
  stateMenu: boolean
  title: boolean
}

/**
 * Watch the drawer on every frame from now on; `stop` hands back what each frame showed.
 * It returns once the first frame is recorded, so what is let in after it is seen arriving.
 */
async function watchCard(page: Page) {
  await page.evaluate(
    ({ title, description }) =>
      new Promise<void>((started) => {
        const samples: Sample[] = []
        const record = () => {
          const drawer = document.querySelector('.drawer')
          const copy = drawer?.querySelector('.description-copy')
          const facts = drawer?.querySelector('.card-facts-block')
          const parent = [...(drawer?.querySelectorAll('.card-row') ?? [])].find((row) =>
            row.querySelector('.card-row-label')?.textContent?.trim().startsWith('Parent'),
          )
          samples.push({
            title: [...(drawer?.querySelectorAll('h1, h2') ?? [])].some(
              (heading) => heading.textContent?.trim() === title,
            ),
            description: copy?.textContent?.includes(description) ?? false,
            stateMenu: Boolean(drawer?.querySelector('.card-facts .choice-select.card-state')),
            parentRow: parent !== undefined,
            parentLink: Boolean(parent?.querySelector('.card-parent')),
            factsBottom: facts?.getBoundingClientRect().bottom ?? Number.NaN,
            descriptionTop: copy?.getBoundingClientRect().top ?? Number.NaN,
          })
          started()
          if (!(window as { stopCardWatch?: boolean }).stopCardWatch) requestAnimationFrame(record)
        }
        Object.assign(window, { cardSamples: samples })
        requestAnimationFrame(record)
      }),
    { title: workItem.title, description: workItem.description },
  )
  return async () => {
    await page.evaluate(() => Object.assign(window, { stopCardWatch: true }))
    return page.evaluate(() => (window as unknown as { cardSamples: Sample[] }).cardSamples)
  }
}

/** A wide window, and a phone's, where the drawer takes the whole width. */
for (const width of [1280, 390])
  test(`a card opened by its address stands before its space has answered, ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page, {
      card: (read) => ({ ...read, parent_id: blockedWorkItem.work_item_id }),
      space: inEpic,
    })
    const late = await lateSpace(page)
    await page.goto(CARD)
    const drawer = page.locator('.drawer')
    await expect(drawer.getByRole('heading', { name: workItem.title })).toBeVisible()
    await expect(drawer.locator('.description-copy')).toHaveText(workItem.description)
    expect(late.answered, 'the card stood only once the space had answered').toBe(false)

    // What the space brings has its place already: the parent's row, and the state as a menu.
    await expect(drawer).toHaveCSS('transform', 'none')
    const stop = await watchCard(page)
    late.release()
    await expect(drawer.locator('.card-parent')).toContainText(blockedWorkItem.reference)
    expect(late.answered).toBe(true)
    // A few frames after the space has been drawn, so a late move would be seen.
    await expect(page.locator('.work-item-tile').first()).toBeVisible()
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    const samples = await stop()

    expect(samples.length).toBeGreaterThan(1)
    expect(samples.filter((frame) => !frame.title || !frame.description)).toEqual([])
    expect(samples.filter((frame) => !frame.stateMenu || !frame.parentRow)).toEqual([])
    // The parent's reference came in while the watch ran, and stayed.
    expect(samples[0]?.parentLink).toBe(false)
    expect(samples.at(-1)?.parentLink).toBe(true)
    expect(new Set(samples.map((frame) => frame.factsBottom)).size).toBe(1)
    expect(new Set(samples.map((frame) => frame.descriptionTop)).size).toBe(1)

    // The state's menu offers the workflow's moves once the space has named them.
    await drawer.locator('.card-facts .card-state').first().click()
    await expect(page.locator('[role="option"]:not([aria-disabled="true"])')).not.toHaveCount(0)
  })

test('a card opened by its address reads its record once, the space beside it', async ({
  page,
}) => {
  await installBackend(page)
  const late = await lateSpace(page)
  const cardReads: boolean[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/modules/planning/work-item')
      cardReads.push(late.answered)
  })
  await page.goto(CARD)
  await expect(page.locator('.drawer').getByRole('heading', { name: workItem.title })).toBeVisible()
  late.release()
  await expect(page.locator('.work-item-tile').first()).toBeVisible()
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  // Asked before the space answered, and not again for the space's first answer.
  expect(cardReads).toEqual([false])
})
