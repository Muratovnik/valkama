import type { Page } from '@playwright/test'

import { requestEntry, requestList } from '../support/inputRequests.ts'
import { projectId, spaceRef, workItem, workItemRef } from './planningFixtures.ts'

export async function installInputRequestBackend(page: Page) {
  const entry = requestEntry()
  entry.target = {
    project_id: projectId,
    space_ref: spaceRef,
    reference: workItemRef.reference,
    writable: true,
  }
  entry.request.work_item_id = workItem.work_item_id
  entry.request.reference = workItemRef.reference
  entry.request.kind = 'question'
  const writes: Record<string, unknown>[] = []
  const reads: string[] = []
  const executionWrites: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/execution/'))
      executionWrites.push(request.url())
  })
  let nextFailure = 0
  await page.route('**/api/modules/planning/request**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    reads.push(`${request.method()} ${url.pathname}${url.search}`)
    if (request.method() === 'GET') {
      if (url.pathname.endsWith('/requests')) {
        const status = url.searchParams.get('status')
        if (status !== null && !['answered', 'declined', 'expired', 'pending'].includes(status))
          return route.fulfill({ status: 400, json: { error: 'invalid status' } })
        const items =
          url.searchParams.get('status') === 'pending' && entry.request.status !== 'pending'
            ? []
            : [structuredClone(entry)]
        return route.fulfill({
          json: {
            ...requestList(items),
            coverage: [
              { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
            ],
          },
        })
      }
      return route.fulfill({ json: { interface_version: 'valkama-planning-requests', ...entry } })
    }
    const body = request.postDataJSON() as Record<string, unknown>
    writes.push(body)
    if (nextFailure) {
      const status = nextFailure
      nextFailure = 0
      entry.request.revision++
      return route.fulfill({ status, json: {} })
    }
    if (body.expected_revision !== entry.request.revision)
      return route.fulfill({ status: 409, json: {} })
    entry.request.status = 'answered'
    entry.request.answers = body.answers as Record<string, boolean>
    entry.request.answered_by = 'user'
    entry.request.by_person = true
    entry.request.resolved_at = '2026-10-24T10:05:00Z'
    entry.request.revision++
    return route.fulfill({ json: { interface_version: 'valkama-planning-requests', ...entry } })
  })
  return {
    entry,
    writes,
    reads,
    executionWrites,
    failNext: (status: number) => (nextFailure = status),
  }
}
