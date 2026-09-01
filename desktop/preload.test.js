'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function loadBridge() {
  const calls = []
  let bridge = null
  const source = readFileSync(path.join(__dirname, 'preload.js'), 'utf8')
  vm.runInNewContext(source, {
    Promise,
    require(moduleName) {
      assert.equal(moduleName, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld(name, value) {
            assert.equal(name, 'valkamaDesktop')
            bridge = value
          },
        },
        ipcRenderer: {
          invoke(channel, request) {
            calls.push({ channel, request })
            return Promise.resolve({ ok: true, mode: 'opened' })
          },
          on() {},
          send() {},
        },
      }
    },
  })
  return { bridge, calls }
}

test('preload forwards only the exact source request object', async () => {
  const { bridge, calls } = loadBridge()
  const request = {
    source: 'docs/plans/source.md#kb:source',
    resource_ref: { kind: 'planning-space', resource_id: 'canonical-resource' },
  }
  const result = await bridge.openSource(request)

  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].channel, 'valkama:open-source')
  assert.equal(calls[0].request, request)
})

test('preload rejects legacy strings and objects carrying path authority', async () => {
  const { bridge, calls } = loadBridge()
  for (const request of [
    'docs/plans/source.md#kb:source',
    { source: 'docs/plans/source.md#kb:source' },
    {
      source: 'docs/plans/source.md#kb:source',
      resource_ref: { kind: 'planning-space', resource_id: 'canonical-resource' },
      root: 'C:\\renderer-root',
    },
  ]) {
    const result = await bridge.openSource(request)
    assert.equal(result.ok, false)
    assert.equal(result.error, 'invalid-source-request')
  }
  assert.equal(calls.length, 0)
})
