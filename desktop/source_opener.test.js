'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { approvedSourceRoot, openSourceRequest } = require('./source_opener')

const DATA_SCOPE_ID = '22222222-2222-4222-8222-222222222222'

function planningResource() {
  return {
    kind: 'planning-space',
    resource_id: Buffer.from(
      JSON.stringify({ data_scope_id: DATA_SCOPE_ID, space_key: 'SOURCE' }),
      'utf8',
    ).toString('base64url'),
  }
}

function registryBytes(root, resourceRef, { bound = true } = {}) {
  return Buffer.from(
    JSON.stringify({
      schema_version: 3,
      projects: [
        {
          project_id: 'source-project',
          display_name: 'Presentation only',
          canonical_root: root,
          planning_binding: bound ? resourceRef : null,
        },
      ],
    }),
    'utf8',
  )
}

function request(resourceRef = planningResource()) {
  return { source: 'plan.md#kb:x1', resource_ref: resourceRef }
}

function shellRecorder() {
  const calls = []
  return {
    calls,
    shell: {
      async openExternal(url) {
        calls.push(['external', url])
      },
      async openPath(file) {
        calls.push(['path', file])
        return ''
      },
    },
  }
}

test('a trusted app request opens from the exact registry-mapped root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'valkama-open-'))
  try {
    await fs.writeFile(path.join(root, 'plan.md'), '# Plan\n<!-- kb:x1 -->\nBody\n', 'utf8')
    const resourceRef = planningResource()
    const { calls, shell } = shellRecorder()
    const result = await openSourceRequest({
      senderUrl: 'http://127.0.0.1:8642/?board=Test',
      appUrl: 'http://127.0.0.1:8642/',
      request: request(resourceRef),
      readBytes: () => registryBytes(root, resourceRef),
      shell,
    })

    assert.equal(result.ok, true)
    assert.equal(result.line, 2)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'external')
    assert.match(calls[0][1], /^vscode:\/\/file\/.*:2:1$/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('an untrusted sender is rejected before registry, filesystem, or shell access', async () => {
  let read = false
  const { calls, shell } = shellRecorder()
  const result = await openSourceRequest({
    senderUrl: 'https://example.com/',
    appUrl: 'http://127.0.0.1:8642/',
    request: request(),
    readBytes() {
      read = true
      return Buffer.from('{}', 'utf8')
    },
    shell,
  })
  assert.equal(result.ok, false)
  assert.equal(read, false)
  assert.equal(calls.length, 0)
})

test('legacy strings and renderer path fields are rejected before registry access', async () => {
  let reads = 0
  const { calls, shell } = shellRecorder()
  for (const legacy of [
    'plan.md#kb:x1',
    { source: 'plan.md#kb:x1' },
    { ...request(), root: 'C:\\renderer-root' },
    { ...request(), cwd: 'C:\\renderer-cwd' },
  ]) {
    const result = await openSourceRequest({
      senderUrl: 'http://127.0.0.1:8642/',
      appUrl: 'http://127.0.0.1:8642/',
      request: legacy,
      readBytes() {
        reads += 1
        return Buffer.from('{}', 'utf8')
      },
      shell,
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'invalid-source-request')
  }
  assert.equal(reads, 0)
  assert.equal(calls.length, 0)
})

test('every non-mapped registry result is refused without shell access', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'valkama-open-'))
  try {
    const resourceRef = planningResource()
    const unavailable = Object.assign(new Error('registry denied'), { code: 'EACCES' })
    const cases = [
      { readBytes: () => registryBytes(root, resourceRef, { bound: false }) },
      { readBytes: () => Buffer.from('{', 'utf8') },
      {
        readBytes() {
          throw unavailable
        },
      },
    ]
    for (const fixture of cases) {
      const { calls, shell } = shellRecorder()
      const result = await openSourceRequest({
        senderUrl: 'http://127.0.0.1:8642/',
        appUrl: 'http://127.0.0.1:8642/',
        request: request(resourceRef),
        readBytes: fixture.readBytes,
        directoryExists: () => true,
        shell,
      })
      assert.equal(result.ok, false)
      assert.equal(result.error, 'space-root-unavailable')
      assert.deepEqual(Object.keys(result).sort(), ['error', 'mode', 'ok'])
      for (const field of ['canonical_root', 'effective_cwd', 'session_cwd', 'root']) {
        assert.equal(Object.hasOwn(result, field), false)
      }
      assert.equal(calls.length, 0)
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('only a validated mapped canonical root is source authority', () => {
  for (const status of ['missing', 'malformed', 'unavailable', 'ambiguous']) {
    assert.equal(
      approvedSourceRoot({ status, validated: false, canonical_root: 'C:\\fallback' }),
      '',
    )
  }
  assert.equal(approvedSourceRoot({ status: 'mapped', canonical_root: 'C:\\forged' }), '')
  assert.equal(
    approvedSourceRoot({ status: 'mapped', validated: true, canonical_root: 'relative-root' }),
    '',
  )
  assert.equal(
    approvedSourceRoot({ status: 'mapped', validated: true, canonical_root: 'C:\\exact' }),
    'C:\\exact',
  )
})
