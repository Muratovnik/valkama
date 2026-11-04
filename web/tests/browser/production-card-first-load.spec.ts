import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import {
  dataScopeId,
  projectId,
  projectScope,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/**
 * A card's address loaded cold — what `/open/<number>` redirects to, a bookmark, a
 * reload — reads what the card shows once.
 *
 * The server's stream sends the space as it stands the moment the page connects,
 * which is the space the page has just read. Taken as news, that first frame read
 * the item, its chain, its history, its questions and its paths a second time. The
 * suite's quiet stream sends nothing, so it never saw it: here the stream sends
 * that first frame, as the server does.
 */

/**
 * A stream whose first frame is the space as the read answered it, sent when the test
 * says: the server's frame comes once it has read the space, after the card has asked.
 */
async function streamFirstFrame(page: Page) {
  const query = new URLSearchParams({
    project: projectId,
    data_scope_id: dataScopeId,
    space_key: spaceRef.space_key,
  })
  const frame = JSON.stringify(planningReadFor(query).body)
  await page.addInitScript((data: string) => {
    class FirstFrame extends EventTarget {
      readonly url: string
      readyState = 1
      constructor(url: string | URL) {
        super()
        this.url = String(url)
        const send = () => this.dispatchEvent(new MessageEvent('message', { data }))
        if (this.url.includes('view=planning')) Object.assign(window, { sendFirstFrame: send })
      }
      close() {
        this.readyState = 2
      }
    }
    Object.defineProperty(window, 'EventSource', { configurable: true, value: FirstFrame })
  }, frame)
}

/** Every GET the page sends, as `path?query`, in the order the page sent them. */
function recordReads(page: Page): string[] {
  const reads: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET') reads.push(`${url.pathname}?${url.searchParams.toString()}`)
  })
  return reads
}

const sent = (reads: readonly string[], path: string) =>
  reads.filter((read) => read.startsWith(`${path}?`)).length

/**
 * Send the frame and wait until whatever it starts has been sent: two frames
 * after it the page has acted on it, and a request it sends after that, which
 * Playwright reports in order, comes after anything the frame started.
 */
async function sendFirstFrame(page: Page, reads: readonly string[]) {
  await page.evaluate(async () => {
    ;(window as unknown as { sendFirstFrame: () => void }).sendFirstFrame()
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    void fetch('/after-the-frame')
  })
  await expect.poll(() => sent(reads, '/after-the-frame')).toBe(1)
}

test('a card loaded from its address reads each of its parts once', async ({ page }) => {
  await installBackend(page)
  await streamFirstFrame(page)
  const reads = recordReads(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  await expect(page.getByRole('heading', { name: workItem.title })).toBeVisible()
  // The card has asked for everything it shows, its paths last.
  await expect.poll(() => sent(reads, '/api/documents/resolve')).toBe(1)
  await sendFirstFrame(page, reads)
  // The frame has been taken: the shell says the space is live.
  await expect(page.locator('.connection-copy')).toHaveText('Connected')
  for (const path of [
    '/api/modules/planning/work-item',
    '/api/planning/work-item/chain',
    '/api/execution/history',
    '/api/documents/resolve',
  ])
    expect(sent(reads, path), path).toBe(1)
  const counts = new Map<string, number>()
  for (const read of reads.filter((each) => each.startsWith('/api/')))
    counts.set(read, (counts.get(read) ?? 0) + 1)
  expect([...counts].filter(([, count]) => count > 1)).toEqual([])
})
