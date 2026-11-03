import type { Locator, Page } from '@playwright/test'

import type { InputRequestEntry, InputRequestField } from '@/shared/api/inputRequestModel.ts'

import { requestEntry, requestList } from '../support/inputRequests.ts'
import { openCard } from './editorPage.ts'
import { projectId, spaceRef, workItem, workItemRef } from './planningFixtures.ts'
import { installStreamDouble } from './streamDouble.ts'

type Request = InputRequestEntry['request']

/**
 * The other parts of an answer follow `answers`, as the server keeps them, so a
 * test that says only what was chosen still sends a whole answered question.
 */
function withAnswerParts(request: Request): Request {
  if (request.answers === null || request.answer_version > 0) return request
  return {
    ...request,
    own: request.own ?? {},
    field_notes: request.field_notes ?? {},
    answer_version: 1,
  }
}

/** A question on the card the browser tests open. */
export function question(request: Partial<Request> = {}): InputRequestEntry {
  const base = requestEntry().request
  return {
    target: {
      project_id: projectId,
      space_ref: spaceRef,
      reference: workItemRef.reference,
      writable: true,
    },
    request: withAnswerParts({
      ...base,
      work_item_id: workItem.work_item_id,
      reference: workItemRef.reference,
      title: workItem.title,
      kind: 'question',
      execution_id: null,
      session_id: null,
      ...request,
    }),
  }
}

export const routeField: InputRequestField = {
  id: 'route',
  label: 'Route',
  type: 'choice',
  required: true,
  options: [
    {
      id: 'keep',
      label: 'Keep the comments',
      description: 'They stay where they are and nothing moves.',
      recommended: true,
    },
    { id: 'move', label: 'Move them', description: 'They go to a table of their own.' },
    { id: 'drop', label: 'Drop them' },
  ],
}

/** The prompt of the question `routeField` answers, which also names its group. */
const ROUTE_PROMPT = 'Where should the **comments** go?'
export const ROUTE_ASKED = 'Where should the comments go?'

/** Several paragraphs of markdown, the most a description is expected to run to. */
const longDescription = (index: number) =>
  [
    `The opening paragraph of the option number ${index}, which says what it does in a sentence long enough to need more than one line wherever it stands.`,
    `A **second paragraph** with what it costs, and how long it takes to undo.`,
    `- one consequence\n- another consequence\n- a third one`,
    `A closing paragraph with [a link](https://example.com/${index}) in it.`,
  ].join('\n\n')

/** Twelve options, every one with a description several paragraphs long. */
export const crowdedField: InputRequestField = {
  id: 'crowded',
  label: 'Option',
  type: 'choice',
  required: true,
  options: Array.from({ length: 12 }, (_, index) => ({
    id: `option-${index + 1}`,
    label: `Option ${index + 1}`,
    description: longDescription(index + 1),
    ...(index === 2 ? { recommended: true } : {}),
  })),
}

/** Three options, one with a line for a description and one that runs on. */
export const mixedField: InputRequestField = {
  id: 'mixed',
  label: 'Option',
  type: 'choice',
  required: true,
  options: [
    { id: 'short', label: 'With a line', description: 'It says this and no more.' },
    { id: 'long', label: 'With a text', description: longDescription(1) },
    { id: 'bare', label: 'With nothing' },
  ],
}

/** How many questions one read of the list brings, as the server's limit does. */
const READ_LIMIT = 100

/** The next `answer_version` and `history` of a question that one of these writes reached. */
function nextVersions(was: Request, action: string): Pick<Request, 'answer_version' | 'history'> {
  if (action !== 'change')
    return { answer_version: action === 'answer' ? 1 : 0, history: was.history }
  const replaced = {
    version: was.answer_version,
    answers: was.answers ?? {},
    own: was.own ?? {},
    field_notes: was.field_notes ?? {},
    note: was.note,
    answered_by: was.answered_by,
    by_person: was.by_person,
    answered_at: was.resolved_at ?? '2026-10-24T10:00:00Z',
  }
  return { answer_version: was.answer_version + 1, history: [...was.history, replaced] }
}

/**
 * The questions' side of the server. The answer is the existing endpoint, and it may
 * come with `note`; `settle` changes a question the way another window would.
 */
export async function installQuestions(page: Page, entries: InputRequestEntry[]) {
  const writes: { action: string; body: Record<string, unknown> }[] = []
  const reads: string[] = []
  let failure: number | 'abort' | null = null
  let refusal: { message: string; status: number } | null = null
  let held: Promise<unknown> = Promise.resolve()
  await page.route('**/api/modules/planning/request**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET') {
      reads.push(url.search)
      if (url.pathname.endsWith('/requests')) {
        const status = url.searchParams.get('status')
        const reference = url.searchParams.get('reference')
        const items = entries
          .filter(
            (entry) =>
              (!status || entry.request.status === status) &&
              (!reference || entry.request.reference === reference),
          )
          .sort((a, b) => b.request.created_at.localeCompare(a.request.created_at))
        return route.fulfill({
          json: {
            ...requestList(structuredClone(items.slice(0, READ_LIMIT))),
            has_more: items.length > READ_LIMIT,
            coverage: [
              { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
            ],
          },
        })
      }
      const found = entries.find((entry) => entry.request.request_id === url.searchParams.get('id'))
      return route.fulfill({
        json: { interface_version: 'valkama-planning-requests', ...found },
      })
    }
    const body = request.postDataJSON() as Record<string, unknown>
    const action = url.pathname.split('/').at(-1) ?? ''
    writes.push({ action, body })
    await held
    if (failure === 'abort') {
      failure = null
      return route.abort('connectionfailed')
    }
    if (failure !== null) {
      const status = failure
      failure = null
      return route.fulfill({ status, json: {} })
    }
    if (refusal) {
      const { message, status } = refusal
      refusal = null
      return route.fulfill({ status, json: { error: { code: 'workflow_guard', message } } })
    }
    const entry = entries.find((candidate) => candidate.request.request_id === body.id)
    if (!entry) return route.fulfill({ status: 404, json: {} })
    if (body.expected_revision !== entry.request.revision)
      return route.fulfill({ status: 409, json: {} })
    const given = action === 'answer' || action === 'change'
    const was = entry.request
    entry.request = {
      ...was,
      status: given ? 'answered' : 'declined',
      answers: given ? (body.answers as Request['answers']) : null,
      own: given ? ((body.own as Request['own'] | undefined) ?? {}) : null,
      field_notes: given ? ((body.field_notes as Request['field_notes'] | undefined) ?? {}) : null,
      ...nextVersions(was, action),
      note: (body.note as string | undefined) ?? null,
      answered_by: 'user',
      by_person: true,
      resolved_at: '2026-10-24T10:05:00Z',
      revision: entry.request.revision + 1,
    }
    return route.fulfill({ json: { interface_version: 'valkama-planning-requests', ...entry } })
  })
  return {
    entries,
    writes,
    reads,
    failNext: (next: number | 'abort') => (failure = next),
    /** The next write is refused with the server's words. */
    refuseNext: (message: string, status = 409) => (refusal = { message, status }),
    /** A write the server does not answer until this settles. */
    holdWrites(until: Promise<unknown>) {
      held = until
    },
    /** A question moved on somewhere else: another window, an agent, its deadline. */
    settle(id: string, change: Partial<Request>) {
      const entry = entries.find((candidate) => candidate.request.request_id === id)
      if (!entry) throw new Error('No such question')
      entry.request = withAnswerParts({
        ...entry.request,
        revision: entry.request.revision + 1,
        ...change,
      })
    },
  }
}

export const QUESTION_ID = '44444444-4444-4444-8444-444444444444'
export const asked = (change: Partial<Request> = {}) =>
  question({ request_id: QUESTION_ID, prompt: ROUTE_PROMPT, fields: [routeField], ...change })

/**
 * A card open on these questions, with the stream under the test's hand. `prepare` adds
 * routes of the test's own, over the backend's, before the page first asks.
 */
export async function openQuestion(
  page: Page,
  entries: InputRequestEntry[],
  prepare?: () => Promise<unknown>,
) {
  let requests: Awaited<ReturnType<typeof installQuestions>> | undefined
  let stream: Awaited<ReturnType<typeof installStreamDouble>> | undefined
  const opened = await openCard(page, async () => {
    requests = await installQuestions(page, entries)
    stream = await installStreamDouble(page)
    await prepare?.()
  })
  if (!requests || !stream) throw new Error('Not installed')
  return { ...opened, requests, stream, card: opened.drawer.locator('.request-card') }
}
export const send = (scope: Locator) => scope.getByRole('button', { name: 'Send', exact: true })
