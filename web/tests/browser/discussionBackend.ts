import type { Page } from '@playwright/test'

import type { WorkItem } from '@/shared/api/planningModel.ts'

import { installBackend } from './backend.ts'
import { now, projectScope, workItem, workItemRef } from './planningFixtures.ts'

function checklistQuote(item: WorkItem, id: unknown) {
  const step = typeof id === 'string' ? item.checklist.find((entry) => entry.id === id) : undefined
  return { checklist_item_id: step?.id ?? null, checklist_item_text: step?.text ?? null }
}

export async function installDiscussionBackend(page: Page) {
  await installBackend(page)
  const item: WorkItem = structuredClone(workItem)
  const writes: Record<string, unknown>[] = []
  let failNext = false
  await page.route('**/api/modules/planning/work-item?*', async (route) => {
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
          payload: {
            work_item: item,
            relations: { interface_version: 'valkama-relations', relations: [] },
          },
        },
      },
    })
  })
  await page.route('**/api/planning/work-item/**', async (route) => {
    const request = route.request()
    const body = request.postDataJSON() as Record<string, unknown>
    writes.push(body)
    if (failNext) {
      failNext = false
      item.revision += 1
      return route.fulfill({ status: 409, json: {} })
    }
    const path = new URL(request.url()).pathname
    if (path.endsWith('/update')) item.description = String(body.description)
    else if (path.endsWith('/summary/select')) {
      const entry = item.comments.find((entry) => entry.id === body.comment_id)
      if (!entry?.report) throw new Error('Expected a saved report')
      item.summary = entry.report
      item.summary_comment_id = entry.id
    } else {
      const report =
        (body.report as { done: string; next: string; why?: string } | undefined) ?? null
      const entry: WorkItem['comments'][number] = {
        id: item.comments.length + 1,
        kind: report ? 'report' : 'comment',
        report,
        body: report ? '' : String(body.body),
        author: 'user',
        at: now,
        ...checklistQuote(item, report ? undefined : body.checklist_item_id),
      }
      item.comments.push(entry)
      if (body.make_current === true) {
        item.summary = report
        item.summary_comment_id = entry.id
      }
    }
    item.revision += 1
    return route.fulfill({ json: item })
  })
  return { item, writes, failNextWrite: () => (failNext = true) }
}
