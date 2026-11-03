'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { claudeLiveness, processAlive, registryDirectory } = require('./live_sessions')

const DIRECTORY = 'C:\\work\\claude-config\\sessions'
const LIVE = 'f89d66c7-f023-4169-8d1a-2e69d4b1af68'
const CRASHED = '0b5a2f4e-31c4-4c1e-9a61-5d3c7d2a9e10'

/** A registry as Claude Code leaves it: a record per process, key files beside them. */
function registry() {
  const files = {
    '4100.json': {
      pid: 4100,
      sessionId: LIVE,
      kind: 'interactive',
      entrypoint: 'claude-vscode',
      messagingSocketPath: '\\\\.\\pipe\\claude-4100',
      bridgeSessionId: 'bridge-1',
    },
    '4100.9f2c1e.key': 'secret-bytes',
    '5200.json': { pid: 5200, sessionId: CRASHED, kind: 'interactive' },
    '5200.77ab01.key': 'secret-bytes',
    '6300.json': '{not json',
    'notes.txt': 'unrelated',
  }
  const reads = []
  return {
    reads,
    options: {
      directory: DIRECTORY,
      readdir: (dir) => {
        assert.equal(dir, DIRECTORY)
        return Object.keys(files)
      },
      readFile: (file) => {
        reads.push(path.basename(file))
        const content = files[path.basename(file)]
        return Buffer.from(typeof content === 'string' ? content : JSON.stringify(content))
      },
      processAlive: (pid) => pid === 4100,
    },
  }
}

test('a live pid is a live session, a dead pid an ended one, an unnamed one no verdict', () => {
  const { options } = registry()
  assert.equal(claudeLiveness(LIVE, options), 'live')
  assert.equal(claudeLiveness(CRASHED, options), 'ended')
  assert.equal(claudeLiveness('6a0e0c55-0000-4000-8000-000000000000', options), '')
})

test('only the per-process records are read, never the key files beside them', () => {
  const { options, reads } = registry()
  claudeLiveness(CRASHED, options)
  assert.deepEqual(reads.sort(), ['4100.json', '5200.json', '6300.json'])
  assert.ok(reads.every((name) => !name.endsWith('.key')))
})

test('a registry that cannot be read says nothing, and the row decides', () => {
  const unreadable = {
    readdir: () => {
      throw Object.assign(new Error('no such directory'), { code: 'ENOENT' })
    },
    readFile: () => assert.fail('nothing to read'),
  }
  assert.equal(claudeLiveness(LIVE, unreadable), '')
})

test('the registry lives under the configured Claude directory', () => {
  assert.equal(
    registryDirectory({ CLAUDE_CONFIG_DIR: 'C:\\work\\claude-config' }),
    path.join('C:\\work\\claude-config', 'sessions'),
  )
})

test('a process is alive by its pid, and an absent pid is not', () => {
  assert.equal(processAlive(process.pid), true)
  // Above the pid range Windows hands out, so no process can hold it.
  assert.equal(processAlive(2 ** 31 - 2), false)
})
