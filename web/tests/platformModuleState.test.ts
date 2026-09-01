import assert from 'node:assert/strict'

import { test } from 'vitest'

import { fetchModules, setModuleState } from '@/shared/api/platformApi.ts'

import { moduleRegistrations } from './support/moduleRegistrations.ts'
import type { FetchInput } from './support/request.ts'
import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'

test('module mutation is optimistic and malformed successful registries fail closed', async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<{ body: unknown; url: string }> = []
  const registrations = moduleRegistrations()
  registrations[0].state = 'disabled'
  registrations[0].revision = 5
  globalThis.fetch = withSecurityBootstrap(async (input: FetchInput, init?: RequestInit) => {
    calls.push({
      url: requestUrl(input),
      body: init?.body ? JSON.parse(requestBody(init.body)) : null,
    })
    if (requestUrl(input) === '/api/modules')
      return new Response(JSON.stringify({ interface_version: 'valkama-modules', modules: [] }), {
        status: 200,
      })
    return new Response(
      JSON.stringify({ interface_version: 'valkama-modules', module: registrations[0] }),
      { status: 200 },
    )
  })
  try {
    await assert.rejects(() => fetchModules(), /bounded non-empty module registry/)
    const changed = await setModuleState('planning', 'disabled', 4)
    assert.equal(changed.manifest.module_id, 'planning')
    assert.deepEqual(calls[1], {
      url: '/api/modules/state',
      body: { module_id: 'planning', state: 'disabled', expected_revision: 4 },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('module mutation preserves conflict status when an adapter returns a short error body', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = withSecurityBootstrap(async () => {
    return new Response(
      JSON.stringify({ status: 'unavailable', reason: 'Module revision changed' }),
      {
        status: 409,
      },
    )
  })
  try {
    await assert.rejects(
      () => setModuleState('analytics', 'disabled', 3),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'HTTP 409' &&
        'status' in error &&
        error.status === 409,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
