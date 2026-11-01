import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchPlanning } from '@/shared/api/planningApi.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'

import { withSecurityBootstrap } from './support/request.ts'

const target = { project: 'alpha', data_scope_id: 'scope', space_key: 'MAIN' }

function answerWith(respond: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(withSecurityBootstrap(respond)))
}

/** The failure a read ends in, as the Work view maps it to its panel copy. */
async function failedRead(respond: () => Promise<Response>) {
  answerWith(respond)
  let error: unknown = null
  await fetchPlanning(target).catch((error_: unknown) => {
    error = error_
  })
  expect(error, 'the read must fail').not.toBeNull()
  const failure: TypedFailure = typedFailure(error)
  return { failure, message: failureMessage(failure) }
}

function envelope(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status })
}

afterEach(() => vi.unstubAllGlobals())

describe('a failed Planning read names its cause and never the raw word unavailable', () => {
  it('maps an empty 500 to the local service sentence', async () => {
    const { failure, message } = await failedRead(async () => new Response('', { status: 500 }))
    expect(failure).toEqual({ code: 'request_failed', status: 500, retryable: true })
    expect(message).toEqual({ key: 'platform.failures.requestFailed' })
  })

  it('maps a 500 with JSON that is not an error envelope to the local service sentence', async () => {
    const { failure, message } = await failedRead(
      async () => new Response(JSON.stringify({ detail: 'boom' }), { status: 500 }),
    )
    expect(failure.code).toBe('request_failed')
    expect(message).toEqual({ key: 'platform.failures.requestFailed' })
  })

  it('maps a 502 HTML page to the local service sentence', async () => {
    const { failure, message } = await failedRead(
      async () =>
        new Response('<html><body>Bad gateway</body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
    )
    expect(failure).toEqual({ code: 'request_failed', status: 502, retryable: true })
    expect(message).toEqual({ key: 'platform.failures.requestFailed' })
  })

  it('maps a dropped connection to the local service sentence', async () => {
    const { failure, message } = await failedRead(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(failure.code).toBe('request_failed')
    expect(message).toEqual({ key: 'platform.failures.requestFailed' })
  })

  it('keeps a 404 error envelope with the unavailable code as a missing record', async () => {
    const { failure, message } = await failedRead(async () =>
      envelope('unavailable', 'project alpha has no planning space yet', 404),
    )
    expect(failure).toEqual({ code: 'not_found', status: 404, retryable: false })
    expect(message).toEqual({ key: 'platform.failures.notFound' })
  })

  it('maps a 409 error envelope with the unavailable code to a dependency that is down', async () => {
    const { failure, message } = await failedRead(async () =>
      envelope('unavailable', 'planning_binding_invalid', 409),
    )
    expect(failure).toEqual({ code: 'dependency_unavailable', status: 409, retryable: false })
    expect(message).toEqual({ key: 'platform.failures.dependencyUnavailable' })
  })
})
