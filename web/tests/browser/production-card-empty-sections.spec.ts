/**
 * A card's sections, in the built application: one with nothing in it is absent, and
 * what arrives while the card is open brings its section back with no reload, each
 * by the road it really takes: a frame of the live stream for a step, and the
 * questions' own read for a question.
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
    // A frame of the stream is the same answer the first read had.
    const answer = await read
    const frame = await answer.text()
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

  test('is absent, and a question brings it back at the questions’ next read', async ({ page }) => {
    const held = await serveCard(page)
    const read = page.waitForResponse('**/api/modules/planning/requests?*')
    await openCard(page)
    await read
    const overview = page.locator('.drawer .overview')
    await expect(overview).toBeVisible()
    const questions = page.getByRole('region', { name: 'Questions and decisions', exact: true })
    await expect(questions).toHaveCount(0)
    await expect(overview.getByText('No questions', { exact: false })).toHaveCount(0)

    held.questions = [aQuestion()]
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(questions).toBeVisible()
    await expect(questions).toContainText('Confirm deployment')
  })

  test('still says a read that failed, with the way to read again', async ({ page }) => {
    const card = await serveCard(page)
    card.failing = true
    const read = page.waitForResponse('**/api/modules/planning/requests?*')
    await openCard(page)
    await read
    const questions = page.getByRole('region', { name: 'Questions and decisions', exact: true })
    // Not knowing is not the same as there being none.
    await expect(questions).toBeVisible()
    await expect(questions.getByRole('alert')).toBeVisible()
    card.failing = false
    await questions.getByRole('button', { name: /refresh/iu }).focus()
    await page.keyboard.press('Enter')
    await expect(questions).toHaveCount(0)
    // The button that said it is gone, and the keyboard is not left at the page's top.
    const held = await page.evaluate(() => document.activeElement?.closest('.drawer') !== null)
    expect(held).toBe(true)
  })
})
