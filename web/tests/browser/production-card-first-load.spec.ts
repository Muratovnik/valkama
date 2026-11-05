import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import {
  dataScopeId,
  projectId,
  projectScope,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { installStreamDouble } from './streamDouble.ts'
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

/** The space as the read answered it: the server's first frame on a stream it opens. */
function firstFrame() {
  const query = new URLSearchParams({
    project: projectId,
    data_scope_id: dataScopeId,
    space_key: spaceRef.space_key,
  })
  return JSON.stringify(planningReadFor(query).body)
}

/**
 * Wait until whatever the frame started has been sent: two frames after it the page
 * has acted on it, and a request it sends after that, which Playwright reports in
 * order, comes after anything the frame started.
 */
async function settle(page: Page, reads: readonly string[]) {
  await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    void fetch('/after-the-frame')
  })
  await expect.poll(() => sent(reads, '/after-the-frame')).toBe(1)
}

test('a card loaded from its address reads each of its parts once', async ({ page }) => {
  await enableExecutionTab(page)
  await installBackend(page)
  const stream = await installStreamDouble(page)
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
  // The server's frame comes once it has read the space, after the card has asked.
  await stream.deliver(firstFrame())
  await settle(page, reads)
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

test('back from a dropped connection, the same space still reads the card again', async ({
  page,
}) => {
  await installBackend(page)
  const stream = await installStreamDouble(page)
  const reads = recordReads(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  await expect(page.getByRole('heading', { name: workItem.title })).toBeVisible()
  await expect.poll(() => sent(reads, '/api/documents/resolve')).toBe(1)
  await stream.deliver(firstFrame())
  await settle(page, reads)
  // What the space does not carry may have moved while the page was away.
  await stream.drop()
  await stream.deliver(firstFrame())
  await expect.poll(() => sent(reads, '/api/modules/planning/work-item')).toBe(2)
})
