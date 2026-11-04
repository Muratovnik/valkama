/**
 * A card's sections, in the built application: one with nothing in it is absent, and
 * what arrives while the card is open brings its section back with no reload, each
 * by the road it really takes: a frame of the live stream for a step, and the
 * questions' own read for a question.
 *
 * The memory tab stands here too, because its form is a section's one action: the
 * button stood under the field it acts on, level with the hint below it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { requestEntry, requestList } from '../support/inputRequests.ts'
import { installBackend } from './backend.ts'
import { projectId, projectScope, spaceRef, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

interface Stream {
  __frame: (data: string) => void
}

/** A live stream the test can speak on: the app hears a frame as it hears the server's. */
async function installStream(page: Page) {
  await page.addInitScript(() => {
    const open = new Set<EventTarget>()
    class TestEventSource extends EventTarget {
      readonly url: string
      readonly readyState = 1
      readonly withCredentials = false
      constructor(url: string | URL) {
        super()
        this.url = String(url)
        open.add(this)
      }
      close() {
        open.delete(this)
      }
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: TestEventSource })
    ;(window as unknown as Stream).__frame = (data) => {
      for (const source of open) source.dispatchEvent(new MessageEvent('message', { data }))
    }
  })
}

/** The card's own record and the questions on it, as the test says they stand now. */
async function serveCard(page: Page) {
  const held = {
    failing: false,
    questions: [] as ReturnType<typeof requestEntry>[],
    steps: [] as unknown[],
  }
  await page.route('**/api/modules/planning/work-item?*', (route) => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('reference') !== workItemRef.reference) return route.fallback()
    return route.fulfill({
      json: {
        interface_version: 'valkama-planning-work-item',
        scope: projectScope,
        work_item_ref: workItemRef,
        state: {
          interface_version: 'valkama-ui-state',
          status: 'ready',
          payload: { work_item: { ...workItem, checklist: held.steps } },
        },
      },
    })
  })
  await page.route('**/api/modules/planning/requests?*', (route) =>
    held.failing
      ? route.fulfill({ status: 500, json: {} })
      : route.fulfill({
          json: {
            ...requestList(held.questions),
            coverage: [
              { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
            ],
          },
        }),
  )
  return held
}

const openCard = (page: Page) =>
  page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )

function aQuestion() {
  const entry = requestEntry()
  entry.target = {
    project_id: projectId,
    space_ref: spaceRef,
    reference: workItemRef.reference,
    writable: true,
  }
  entry.request.work_item_id = workItem.work_item_id
  entry.request.reference = workItemRef.reference
  return entry
}

test.describe('a section with nothing in it', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await installBackend(page)
    await installStream(page)
  })

  test('is absent, and a step arriving on the stream brings it back', async ({ page }) => {
    const held = await serveCard(page)
    const read = page.waitForResponse(
      (answer) => new URL(answer.url()).pathname === '/api/planning',
    )
    await openCard(page)
    // A frame of the stream is the answer the first read had, as the store stands then.
    const answer = await read
    const first = (await answer.json()) as {
      work_items: { checklist: unknown[]; reference: string }[]
    }
    const overview = page.locator('.drawer .overview')
    await expect(overview).toBeVisible()
    await expect(overview.getByText('Description', { exact: true })).toBeVisible()
    const checklist = overview.getByRole('heading', { name: /^Checklist/u })
    await expect(checklist).toHaveCount(0)
    await expect(overview.getByText('No checklist', { exact: false })).toHaveCount(0)

    held.steps = [
      {
        id: '00000000-0000-4000-8000-000000000301',
        text: 'A step',
        done: false,
        claimed_by: '',
        done_by: '',
      },
    ]
    // The step is in the space too, so the frame that brings it differs from the read.
    const frame = JSON.stringify({
      ...first,
      work_items: first.work_items.map((item) =>
        item.reference === workItemRef.reference ? { ...item, checklist: held.steps } : item,
      ),
    })
    await page.evaluate((data) => {
      ;(window as unknown as Stream).__frame(data)
    }, frame)
    await expect(checklist).toBeVisible()
    await expect(overview.getByRole('checkbox', { name: 'A step' })).toBeVisible()
    // At the distance every heading keeps from what it heads.
    const heading = await checklist.boundingBox()
    const steps = await overview.locator('.checklist').boundingBox()
    expect((steps?.y ?? 0) - (heading?.y ?? 0) - (heading?.height ?? 0)).toBe(12)
  })

  test('holds no question until the next read brings one into the discussion', async ({ page }) => {
    const held = await serveCard(page)
    const read = page.waitForResponse('**/api/modules/planning/requests?*')
    await openCard(page)
    await read
    const overview = page.locator('.drawer .overview')
    await expect(overview).toBeVisible()
    const question = overview.locator('.request-card')
    await expect(question).toHaveCount(0)
    await expect(overview.getByText('No questions', { exact: false })).toHaveCount(0)

    held.questions = [aQuestion()]
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(question).toBeVisible()
    await expect(question).toContainText('Should deployment proceed?')
  })

  test('still says a read that failed, with the way to read again', async ({ page }) => {
    const card = await serveCard(page)
    card.failing = true
    const read = page.waitForResponse('**/api/modules/planning/requests?*')
    await openCard(page)
    await read
    const discussion = page.locator('.drawer .discussion')
    // Not knowing is not the same as there being none.
    const unread = discussion.locator('.questions-unread')
    await expect(unread).toContainText('could not be refreshed')
    card.failing = false
    await unread.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(unread).toHaveCount(0)
    // The button goes with the failure it answers, and focus must not go with it.
    await expect(page.locator('.drawer .drawer-frame-body')).toBeFocused()
  })
})

for (const width of [390, 1440]) {
  test(`the memory search stands level with its field at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await openCard(page)
    const drawer = page.locator('.drawer')
    await drawer
      .locator('.drawer-frame-tabs')
      .getByRole('radio', { name: /Memory/iu })
      .click()
    const form = drawer.locator('.memory-form')
    const input = form.getByRole('textbox')
    const find = form.getByRole('button')
    const field = await input.boundingBox()
    const button = await find.boundingBox()
    expect(button?.y).toBeCloseTo(field?.y ?? Number.NaN, 0)
    expect((button?.y ?? 0) + (button?.height ?? 0)).toBeCloseTo(
      (field?.y ?? 0) + (field?.height ?? 0),
      0,
    )
    // The hint belongs to the field and is still announced with it, under the row.
    const hint = await input.getAttribute('aria-describedby')
    const said = drawer.locator(`[id="${hint}"]`)
    await expect(said).toHaveText(/./u)
    const hintBox = await said.boundingBox()
    expect(hintBox?.y ?? 0).toBeGreaterThanOrEqual((field?.y ?? 0) + (field?.height ?? 0))
  })
}
