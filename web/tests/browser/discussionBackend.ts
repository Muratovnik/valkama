import type { Page } from '@playwright/test'

import type { WorkItem } from '@/shared/api/planningModel.ts'

import { asRoot } from '../support/threads.ts'
import { installBackend } from './backend.ts'
import { doneState, now, projectScope, workItem, workItemRef } from './planningFixtures.ts'

function checklistQuote(item: WorkItem, id: unknown) {
  const step = typeof id === 'string' ? item.checklist.find((entry) => entry.id === id) : undefined
  return { checklist_item_id: step?.id ?? null, checklist_item_text: step?.text ?? null }
}

const nextId = (item: WorkItem) => Math.max(0, ...item.comments.map((entry) => entry.id)) + 1

function markThread(item: WorkItem, body: Record<string, unknown>) {
  const root = item.comments.find((entry) => entry.id === body.comment_id)
  if (!root) return { status: 404, json: {} }
  root.resolution =
    body.reopen === true
      ? null
      : {
          at: new Date().toISOString(),
          by: 'user',
          by_person: true,
          text: String(body.resolution),
        }
  return { json: { work_item: item.reference, comment_id: root.id, resolution: root.resolution } }
}

function writeReply(item: WorkItem, body: Record<string, unknown>) {
  const reply: WorkItem['comments'][number] = {
    id: nextId(item),
    kind: 'comment',
    author: 'user',
    at: new Date().toISOString(),
    ...asRoot,
    by_person: true,
    reply_to: (body.reply_to as number | undefined) ?? null,
    reply_to_request: (body.reply_to_request as string | undefined) ?? null,
    report: null,
    body: String(body.body),
  }
  item.comments.push(reply)
  return {
    work_item: item.reference,
    comment_count: item.comments.length,
    comment_id: reply.id,
    reply_to: reply.reply_to,
    reply_to_request: reply.reply_to_request,
  }
}

const isThreadWrite = (path: string, body: Record<string, unknown>) =>
  path.endsWith('/comment/resolve') ||
  body.reply_to !== undefined ||
  body.reply_to_request !== undefined

function threadWrite(
  item: WorkItem,
  path: string,
  body: Record<string, unknown>,
  marks: { failNext: boolean },
) {
  if (!path.endsWith('/comment/resolve')) return { json: writeReply(item, body) }
  if (!marks.failNext) return markThread(item, body)
  marks.failNext = false
  return { status: 500, json: {} }
}

export async function installDiscussionBackend(page: Page) {
  await installBackend(page)
  const item: WorkItem = structuredClone(workItem)
  const writes: Record<string, unknown>[] = []
  let failNext = false
  const marks = { failNext: false }
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
          },
        },
      },
    })
  })
  await page.route('**/api/planning/work-item/**', async (route) => {
    const request = route.request()
    // Reads under this path (the card's chain) belong to the shared backend.
    if (request.method() === 'GET') return route.fallback()
    const body = request.postDataJSON() as Record<string, unknown>
    writes.push(body)
    if (failNext) {
      failNext = false
      item.revision += 1
      return route.fulfill({ status: 409, json: {} })
    }
    const path = new URL(request.url()).pathname
    // The contract's two thread answers: neither is the item, and neither moves its revision.
    if (isThreadWrite(path, body)) return route.fulfill(threadWrite(item, path, body, marks))
    if (path.endsWith('/transition')) {
      if (!item.summary) {
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'workflow_guard',
              message: `[summary] ${item.reference} has no closing summary; record what was done and what comes next before closing it`,
            },
          },
        })
      }
      item.state = { ...doneState }
    } else if (path.endsWith('/update')) item.description = String(body.description)
    else if (path.endsWith('/summary/select')) {
      const entry = item.comments.find((entry) => entry.id === body.comment_id)
      if (!entry?.report) throw new Error('Expected a saved report')
      item.summary = entry.report
      item.summary_comment_id = entry.id
    } else {
      const report =
        (body.report as { done: string; next: string; why?: string } | undefined) ?? null
      const saved = {
        id: item.comments.length + 1,
        author: 'user',
        at: now,
      }
      const entry: WorkItem['comments'][number] = report
        ? {
            ...saved,
            kind: 'report',
            ...asRoot,
            report,
            body: '',
            checklist_item_id: null,
            checklist_item_text: null,
          }
        : {
            ...saved,
            kind: 'comment',
            ...asRoot,
            report: null,
            body: String(body.body),
            ...checklistQuote(item, body.checklist_item_id),
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
  return {
    item,
    writes,
    failNextWrite: () => (failNext = true),
    failNextMark: () => (marks.failNext = true),
  }
}
