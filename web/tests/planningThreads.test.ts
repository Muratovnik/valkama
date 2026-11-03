/**
 * The thread forms of the connection contract ("Threads and the resolved mark"),
 * read through the card's own validator and written through its own calls. The
 * payloads are the contract's examples, so a drift between them and the schemas
 * fails here rather than on a card.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { replyInThread, resolveThread } from '@/shared/api/planningApi.ts'
import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'

import { workItemFixture } from './fixtures/workItem.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'
import { asRoot } from './support/threads.ts'

afterEach(() => vi.unstubAllGlobals())

const QUESTION = '7d1c2a9e-3f4b-4c5d-8e6f-0a1b2c3d4e5f'
const mark = {
  at: '2026-11-03T11:30:00.000000Z',
  by: 'user',
  by_person: true,
  text: 'Moved to MAIN-14',
}
const row = { report: null, checklist_item_id: null, checklist_item_text: null } as const

const resolvedRoot = {
  id: 41,
  kind: 'comment',
  author: 'codex',
  by_person: false,
  body: 'The export leaves out step claims.',
  at: '2026-11-03T09:00:00.000000Z',
  ...row,
  reply_to: null,
  reply_to_request: null,
  resolution: mark,
}
const replyToRoot = {
  id: 44,
  kind: 'comment',
  author: 'user',
  by_person: true,
  body: 'Only the claims, the steps are there.',
  at: '2026-11-03T09:20:00.000000Z',
  ...row,
  reply_to: 41,
  reply_to_request: null,
  resolution: null,
}
const replyToQuestion = {
  ...replyToRoot,
  id: 45,
  author: 'codex',
  by_person: false,
  reply_to: null,
  reply_to_request: QUESTION,
}
const reportRoot = {
  id: 46,
  kind: 'report',
  author: 'codex',
  body: '',
  at: '2026-11-03T09:30:00.000000Z',
  report: { done: 'Shipped', next: 'Review' },
  checklist_item_id: null,
  checklist_item_text: null,
  ...asRoot,
}

const identity = { state: 'confirmed', source: 'browser', session_id: null, agent_id: null }
const event = (action: string, detail: string) => ({
  action,
  detail,
  author: 'user',
  at: '2026-11-03T11:30:00.000000Z',
  identity,
})

function card(comments: unknown[], events: unknown[] = []) {
  return { ...workItemFixture('Threads', 4), comments, events }
}

describe('a card with threads', () => {
  it('reads a resolved root, its reply, a reply under a question, a report and the mark events', () => {
    const read = validateWorkItemRecord(
      card(
        [resolvedRoot, replyToRoot, replyToQuestion, reportRoot],
        [
          event('comment_resolved', '41: Moved to MAIN-14'),
          event('comment_reopened', '41'),
          event('request_changed', QUESTION),
        ],
      ),
    )
    expect(read.comments.map((comment) => [comment.reply_to, comment.reply_to_request])).toEqual([
      [null, null],
      [41, null],
      [null, QUESTION],
      [null, null],
    ])
    expect(read.comments[0]?.resolution).toEqual(mark)
    expect(read.events.map((entry) => entry.action)).toEqual([
      'comment_resolved',
      'comment_reopened',
      'request_changed',
    ])
  })

  it.each([
    ['two parents', { ...replyToRoot, reply_to_request: QUESTION }],
    ['a reply with a mark', { ...replyToRoot, resolution: mark }],
    ['a reply bound to a step', { ...replyToRoot, checklist_item_id: QUESTION }],
    ['a report as a reply', { ...reportRoot, reply_to: 41 }],
    ['a mark of two lines', { ...resolvedRoot, resolution: { ...mark, text: 'One\nTwo' } }],
    ['a mark past 280', { ...resolvedRoot, resolution: { ...mark, text: 'x'.repeat(281) } }],
  ])('refuses %s', (_, comment) => {
    expect(() => validateWorkItemRecord(card([comment]))).toThrow()
  })

  it.each(['reply_to', 'reply_to_request', 'by_person', 'resolution'])(
    'refuses a comment without %s, so a server that stops sending it is noticed',
    (key) => {
      const comment: Record<string, unknown> = { ...replyToRoot }
      delete comment[key]
      expect(() => validateWorkItemRecord(card([replyToRoot]))).not.toThrow()
      expect(() => validateWorkItemRecord(card([comment]))).toThrow()
    },
  )
})

function serve(answer: unknown) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(withSecurityBootstrap(async () => new Response(JSON.stringify(answer))))
  vi.stubGlobal('fetch', fetchMock)
  return () => {
    const call = fetchMock.mock.calls.find(([url]) => requestUrl(url) !== '/api/security/bootstrap')
    return { url: requestUrl(call?.[0] ?? ''), body: JSON.parse(requestBody(call?.[1]?.body)) }
  }
}

describe('thread writes', () => {
  it('replies under a comment and reads the root the reply landed under', async () => {
    const answer = {
      work_item: 'MAIN-12',
      comment_count: 9,
      comment_id: 46,
      reply_to: 41,
      reply_to_request: null,
    }
    const sent = serve(answer)
    expect(await replyInThread({ id: 'MAIN-12', body: 'Agreed', reply_to: 44 })).toEqual(answer)
    expect(sent()).toEqual({
      url: '/api/planning/work-item/comment',
      body: { author: 'user', id: 'MAIN-12', body: 'Agreed', reply_to: 44 },
    })
  })

  it('replies under a question', async () => {
    const sent = serve({
      work_item: 'MAIN-12',
      comment_count: 10,
      comment_id: 47,
      reply_to: null,
      reply_to_request: QUESTION,
    })
    await replyInThread({ id: 'MAIN-12', body: 'Which docs?', reply_to_request: QUESTION })
    expect(sent().body).toEqual({
      author: 'user',
      id: 'MAIN-12',
      body: 'Which docs?',
      reply_to_request: QUESTION,
    })
  })

  it('refuses an answer that does not say where the reply landed', async () => {
    serve({ work_item: 'MAIN-12', comment_count: 9, comment_id: 46 })
    await expect(replyInThread({ id: 'MAIN-12', body: 'Agreed', reply_to: 41 })).rejects.toThrow(
      /missing field/u,
    )
  })

  it('marks a root resolved with its decision', async () => {
    const answer = { work_item: 'MAIN-12', comment_id: 41, resolution: mark }
    const sent = serve(answer)
    expect(
      await resolveThread({ id: 'MAIN-12', comment_id: 41, resolution: 'Moved to MAIN-14' }),
    ).toEqual(answer)
    expect(sent()).toEqual({
      url: '/api/planning/work-item/comment/resolve',
      body: { author: 'user', id: 'MAIN-12', comment_id: 41, resolution: 'Moved to MAIN-14' },
    })
  })

  it('reopens a root and reads that it has no mark', async () => {
    const sent = serve({ work_item: 'MAIN-12', comment_id: 41, resolution: null })
    const reopened = await resolveThread({ id: 'MAIN-12', comment_id: 41, reopen: true })
    expect(reopened.resolution).toBeNull()
    expect(sent().body).toEqual({ author: 'user', id: 'MAIN-12', comment_id: 41, reopen: true })
  })
})
