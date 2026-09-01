import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { requestBody, requestUrl } from './support/request.ts'

const TOKEN_A = 'A'.repeat(64)
const TOKEN_B = 'B'.repeat(64)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadSecureFetch() {
  const module = await import('@/shared/api/secureFetch.ts')
  return module.secureFetch
}

describe('secureFetch', () => {
  it('leaves reads credential-free and does not bootstrap', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const secureFetch = await loadSecureFetch()
    await secureFetch('/api/modules')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/modules', undefined)
  })

  it('bootstraps once and keeps the token only in the write header', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session_token: TOKEN_A }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    const secureFetch = await loadSecureFetch()
    await secureFetch('/api/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    await secureFetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/security/bootstrap')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' })
    for (const call of fetchMock.mock.calls.slice(1)) {
      const init = call[1]
      expect(new Headers(init?.headers).get('X-Valkama-Session')).toBe(TOKEN_A)
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
      expect(requestUrl(call[0])).not.toContain(TOKEN_A)
      expect(requestBody(init?.body)).not.toContain(TOKEN_A)
    }
  })

  it('clears, re-bootstraps, and retries exactly once after a stale-token 401', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ session_token: TOKEN_A })))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ session_token: TOKEN_B })))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const secureFetch = await loadSecureFetch()
    const response = await secureFetch('/api/card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(response.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/security/bootstrap',
      '/api/card',
      '/api/security/bootstrap',
      '/api/card',
    ])
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('X-Valkama-Session')).toBe(
      TOKEN_A,
    )
    expect(new Headers(fetchMock.mock.calls[3]?.[1]?.headers).get('X-Valkama-Session')).toBe(
      TOKEN_B,
    )
  })

  it('rejects unsafe write targets before bootstrap or network access', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {
      location: {
        href: 'http://127.0.0.1:8642/',
        origin: 'http://127.0.0.1:8642',
        host: '127.0.0.1:8642',
      },
    })
    const secureFetch = await loadSecureFetch()
    const origin = window.location.origin
    const credentialTarget = new URL('/api/comment', origin)
    credentialTarget.username = 'user'
    credentialTarget.password = 'secret'
    const unsafeTargets: Array<RequestInfo | URL> = [
      'https://foreign.example/api/comment',
      `//${window.location.host}/api/comment`,
      credentialTarget,
      `${origin}/settings`,
    ]

    for (const target of unsafeTargets) {
      await expect(secureFetch(target, { method: 'POST', body: '{}' })).rejects.toThrow(
        'secure writes require a same-origin /api/ target',
      )
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts relative and same-origin absolute API writes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ session_token: TOKEN_A })))
      .mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', {
      location: {
        href: 'http://127.0.0.1:8642/',
        origin: 'http://127.0.0.1:8642',
        host: '127.0.0.1:8642',
      },
    })
    const secureFetch = await loadSecureFetch()
    const absolute = new URL('/api/summary', window.location.origin)

    await secureFetch('/api/comment', { method: 'POST', body: '{}' })
    await secureFetch(absolute, { method: 'PUT', body: '{}' })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/comment')
    expect(fetchMock.mock.calls[2]?.[0]).toBe(absolute)
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('X-Valkama-Session')).toBe(
      TOKEN_A,
    )
    expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('X-Valkama-Session')).toBe(
      TOKEN_A,
    )
  })

  it('contains no browser persistence or cookie credential surface', () => {
    const path = fileURLToPath(new URL('../src/shared/api/secureFetch.ts', import.meta.url))
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/u)
    expect(source).not.toMatch(/export\s+(?:const|let|var)\s+.*token/iu)
  })
})
