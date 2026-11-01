'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { LOG_NAME, createStartupLog } = require('./startup_log')

test('each line is a UTC instant, the process, the step and its offset from the exe start', () => {
  const lines = []
  let clock = Date.UTC(2026, 10, 1, 8, 27, 21, 500)
  const log = createStartupLog({
    directory: 'unused',
    pid: 1234,
    startedAt: Date.UTC(2026, 10, 1, 8, 27, 21, 0),
    now: () => clock,
    write: (line) => lines.push(line),
  })
  log('app-ready')
  clock += 212
  log('server-ready', { mode: 'started', pid: 4242, ms: 180, detail: 'two words', empty: '' })
  assert.deepEqual(lines, [
    '2026-11-01T08:27:21.500Z desktop[1234] app-ready +500ms\n',
    '2026-11-01T08:27:21.712Z desktop[1234] server-ready +712ms mode=started pid=4242 ms=180 detail="two words"\n',
  ])
})

test('a log that cannot be written never stops the caller', () => {
  const log = createStartupLog({
    directory: 'unused',
    pid: 1,
    startedAt: 0,
    write: () => {
      throw new Error('EBUSY')
    },
  })
  assert.doesNotThrow(() => log('window-created'))
})

test('the file lives beside the tray log and is rotated once it grows past a megabyte', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'valkama-log-'))
  try {
    const file = path.join(directory, LOG_NAME)
    writeFileSync(file, 'x'.repeat(1024 * 1024 + 1))
    const log = createStartupLog({ directory, pid: 9, startedAt: Date.now() })
    log('main-start')
    assert.equal(readFileSync(`${file}.1`, 'utf8').length, 1024 * 1024 + 1)
    assert.match(readFileSync(file, 'utf8'), /^\S+ desktop\[9\] main-start \+\d+ms\n$/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
