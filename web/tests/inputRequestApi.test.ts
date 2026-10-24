import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  answerInputRequest,
  declineInputRequest,
  fetchInputRequest,
  fetchInputRequests,
} from '@/shared/api/inputRequestApi.ts'
import {
  validateInputRequestDetail,
  validateInputRequestList,
} from '@/shared/api/inputRequestModel.ts'

import { requestEntry, requestList } from './support/inputRequests.ts'
import { present } from './support/present.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'

afterEach(() => vi.unstubAllGlobals())

function serve(payload: unknown, status = 200) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(
      withSecurityBootstrap(async () => new Response(JSON.stringify(payload), { status })),
    )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('input request wire contract', () => {
  it('reads the exact project and space and preserves explicit partial coverage', async () => {
    const entry = requestEntry()
    const payload = requestList()
    payload.coverage[0] = {
      project_id: entry.target.project_id,
      space_ref: entry.target.space_ref,
      status: 'unavailable',
      reason: 'store_unavailable',
    }
    payload.has_more = true
    const fetchMock = serve(payload)
    const result = await fetchInputRequests({ target: entry.target, status: 'all' })
    expect(result.has_more).toBe(true)
    expect(result.coverage[0]?.status).toBe('unavailable')
    const query = new URL(
      requestUrl(present(fetchMock.mock.calls[0]?.[0], 'request URL')),
      'https://test.example',
    ).searchParams
    expect(Object.fromEntries(query)).toEqual({
      scope_kind: 'project',
      limit: '100',
      project_id: entry.target.project_id,
      data_scope_id: entry.target.space_ref.data_scope_id,
      space_key: 'TASK',
      reference: 'TASK-7',
    })
  })

  it('uses the request revision and sends a required boolean false without coercion', async () => {
    const entry = requestEntry()
    const answered = {
      ...entry,
      request: {
        ...entry.request,
        status: 'answered',
        answers: { proceed: false },
        revision: 2,
        resolved_at: '2026-10-24T10:01:00Z',
        answered_by: 'user',
      },
    }
    const fetchMock = serve({ interface_version: 'valkama-planning-requests', ...answered })
    expect(await answerInputRequest(entry, { proceed: false })).toEqual(answered)
    const write = fetchMock.mock.calls.find(([url]) => requestUrl(url).endsWith('/request/answer'))
    expect(JSON.parse(requestBody(write?.[1]?.body))).toEqual({
      project_id: entry.target.project_id,
      data_scope_id: entry.target.space_ref.data_scope_id,
      space_key: 'TASK',
      id: entry.request.request_id,
      expected_revision: 1,
      author: 'user',
      answers: { proceed: false },
    })
    expect(new Headers(write?.[1]?.headers).get('X-Valkama-Session')).toBe('S'.repeat(64))
  })

  it('preserves a typed stale-revision refusal and never retries a declined write as an answer', async () => {
    const fetchMock = serve(
      { error: { code: 'revision_conflict', message: 'stale revision' } },
      409,
    )
    await expect(declineInputRequest(requestEntry())).rejects.toMatchObject({ status: 409 })
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.[0]).toBe('/api/modules/planning/request/decline')
  })

  it('refuses malformed targets, duplicate field IDs and contradictory answer states', () => {
    const entry = requestEntry()
    const envelope = { interface_version: 'valkama-planning-requests', ...entry }
    expect(() =>
      validateInputRequestDetail({
        ...envelope,
        target: { ...entry.target, reference: 'OTHER-7' },
      }),
    ).toThrow()
    expect(() =>
      validateInputRequestDetail({
        ...envelope,
        request: { ...entry.request, fields: [...entry.request.fields, ...entry.request.fields] },
      }),
    ).toThrow()
    expect(() =>
      validateInputRequestDetail({
        ...envelope,
        request: { ...entry.request, answers: { proceed: true } },
      }),
    ).toThrow()
    expect(() => validateInputRequestList({ ...requestList(), unknown: true })).toThrow()
  })

  it('reads detail by request UUID in the exact source and strips envelope metadata', async () => {
    const entry = requestEntry()
    const fetchMock = serve({ interface_version: 'valkama-planning-requests', ...entry })
    expect(await fetchInputRequest(entry.target, entry.request.request_id)).toEqual(entry)
    expect(requestUrl(present(fetchMock.mock.calls[0]?.[0], 'request URL'))).toContain(
      `id=${entry.request.request_id}`,
    )
    expect(requestUrl(present(fetchMock.mock.calls[0]?.[0], 'request URL'))).toContain(
      `data_scope_id=${entry.target.space_ref.data_scope_id}`,
    )
  })
})
