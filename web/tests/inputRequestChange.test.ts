/**
 * The answer forms of the connection contract ("Questions and decisions"): own
 * variants, field comments, versions and the change of a given answer. The
 * question with a history is the contract's own example.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { answerInputRequest, changeInputRequestAnswer } from '@/shared/api/inputRequestApi.ts'
import { validateInputRequestDetail } from '@/shared/api/inputRequestModel.ts'

import { firstAnswer, requestEntry } from './support/inputRequests.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'

afterEach(() => vi.unstubAllGlobals())

const fields = [
  {
    id: 'route',
    label: 'Route',
    type: 'choice' as const,
    required: true,
    options: [
      { id: 'flat', label: 'Flat' },
      { id: 'threads', label: 'Threads' },
    ],
  },
  {
    id: 'release',
    label: 'Release',
    type: 'choice' as const,
    required: true,
    options: [{ id: 'now', label: 'Now' }],
  },
]

/** The contract's example: an answer changed once, with its first version kept. */
function changed() {
  const entry = requestEntry()
  return {
    interface_version: 'valkama-planning-requests',
    target: entry.target,
    request: {
      ...entry.request,
      fields,
      status: 'answered',
      answers: { route: 'threads' },
      own: { release: 'In a week, after acceptance' },
      field_notes: { route: 'Threads serve the digest too' },
      note: 'A comment on the whole question',
      answer_version: 2,
      answered_by: 'user',
      by_person: true,
      resolved_at: '2026-11-03T12:00:00.000000Z',
      revision: 3,
      history: [
        {
          version: 1,
          answers: { route: 'flat' },
          own: {},
          field_notes: {},
          note: null,
          answered_by: 'codex',
          by_person: false,
          answered_at: '2026-11-03T09:00:00.000000Z',
        },
      ],
    },
  }
}

describe('a question with versions', () => {
  it('reads the answer in force with its own variants, comments and the version it replaced', () => {
    const { request } = validateInputRequestDetail(changed())
    expect(request.own).toEqual({ release: 'In a week, after acceptance' })
    expect(request.field_notes).toEqual({ route: 'Threads serve the digest too' })
    expect(request.answer_version).toBe(2)
    expect(request.history.map((version) => [version.version, version.by_person])).toEqual([
      [1, false],
    ])
  })

  it('reads a pending question as having no answer parts and no version', () => {
    const entry = requestEntry()
    const { request } = validateInputRequestDetail({
      interface_version: 'valkama-planning-requests',
      ...entry,
    })
    expect([request.own, request.field_notes, request.answer_version]).toEqual([null, null, 0])
  })

  it.each([
    ['a history shorter than the version says', { history: [] }],
    ['a version out of order', { history: [{ ...changed().request.history[0], version: 2 }] }],
    ['an answered question without own', { own: null }],
    ['an answered question at version 0', { answer_version: 0, history: [] }],
    ['an own variant that is blank', { own: { release: '' } }],
    ['a field comment past 2000', { field_notes: { route: 'x'.repeat(2001) } }],
  ])('refuses %s', (_, change) => {
    const payload = changed()
    expect(() =>
      validateInputRequestDetail({ ...payload, request: { ...payload.request, ...change } }),
    ).toThrow()
  })

  it.each(['own', 'field_notes', 'answer_version', 'history'])(
    'refuses a question without %s, so a server that stops sending it is noticed',
    (key) => {
      const payload = changed()
      const request: Record<string, unknown> = { ...payload.request }
      delete request[key]
      expect(() => validateInputRequestDetail({ ...payload, request })).toThrow()
    },
  )
})

function serve(answer: unknown) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(withSecurityBootstrap(async () => new Response(JSON.stringify(answer))))
  vi.stubGlobal('fetch', fetchMock)
  return () =>
    fetchMock.mock.calls
      .filter(([url]) => requestUrl(url) !== '/api/security/bootstrap')
      .map(([url, init]) => ({ url: requestUrl(url), body: JSON.parse(requestBody(init?.body)) }))
}

describe('answer writes', () => {
  it('sends own variants and field comments beside the answers, and leaves blank ones out', async () => {
    const entry = requestEntry()
    const sent = serve({
      interface_version: 'valkama-planning-requests',
      target: entry.target,
      request: { ...entry.request, status: 'answered', answers: {}, ...firstAnswer, revision: 2 },
    })
    await answerInputRequest(entry, {}, '', {
      own: { proceed: '  Only after the review ', other: '  ' },
      field_notes: { proceed: '' },
    })
    expect(sent()[0]?.body).toEqual({
      project_id: entry.target.project_id,
      data_scope_id: entry.target.space_ref.data_scope_id,
      space_key: 'TASK',
      id: entry.request.request_id,
      expected_revision: 1,
      author: 'user',
      answers: {},
      own: { proceed: 'Only after the review' },
    })
  })

  it('changes the answer in force on its own path, guarded by the request revision', async () => {
    const before = validateInputRequestDetail(changed())
    const after = changed()
    after.request = { ...after.request, answer_version: 3, revision: 4 }
    after.request.history = [
      ...after.request.history,
      { ...after.request.history[0], version: 2 } as (typeof after.request.history)[number],
    ]
    const sent = serve(after)
    const read = await changeInputRequestAnswer(
      before,
      { route: 'flat' },
      {
        field_notes: { route: 'Back to flat after all' },
        note: ' ',
      },
    )
    expect(read.request.answer_version).toBe(3)
    expect(sent()).toEqual([
      {
        url: '/api/modules/planning/request/change',
        body: {
          project_id: before.target.project_id,
          data_scope_id: before.target.space_ref.data_scope_id,
          space_key: 'TASK',
          id: before.request.request_id,
          expected_revision: 3,
          author: 'user',
          answers: { route: 'flat' },
          field_notes: { route: 'Back to flat after all' },
        },
      },
    ])
  })
})
