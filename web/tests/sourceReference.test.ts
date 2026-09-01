import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import { openSourceReference, sourceFeedback } from '@/shared/lib/sourceReference.ts'

const request = {
  source: 'docs/plans/source.md#kb:source',
  resource_ref: { kind: 'planning-space' as const, resource_id: 'canonical-resource' },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('desktop receives the one strict source request object unchanged', async () => {
  const openSource = vi.fn().mockResolvedValue({ ok: true, mode: 'opened' })
  vi.stubGlobal('window', { valkamaDesktop: { openSource } })

  await openSourceReference(request)

  assert.equal(openSource.mock.calls.length, 1)
  assert.equal(openSource.mock.calls[0]?.length, 1)
  assert.deepEqual(openSource.mock.calls[0]?.[0], request)
})

test('browser fallback copies only the source pointer from the same request', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })

  assert.deepEqual(await openSourceReference(request), { ok: true, mode: 'copied' })
  assert.deepEqual(writeText.mock.calls, [[request.source]])
})

test('successful Electron source handoff is silent while copy and failure stay explicit', () => {
  assert.equal(sourceFeedback({ ok: true, mode: 'opened', line: 42 }), null)
  assert.equal(sourceFeedback({ ok: true, mode: 'copied' }), 'copied')
  assert.equal(sourceFeedback({ ok: false, mode: 'opened', error: 'no handler' }), 'failed')
})
