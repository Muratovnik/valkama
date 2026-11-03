'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Whether a Claude Code session's process is running, at the moment of a click.
//
// `sessions.status` lags a crash by the length of a lease, and the server cannot
// tell a dead process from a live one. Claude Code keeps one small file per
// running session in `<config>/sessions/<pid>.json`, "used to detect concurrent
// sessions and crashes"; its VS Code extension reads it the same way on Windows,
// by the pid alone. Only `sessionId` and `pid` are taken from a file. The
// `*.key` files beside them, and every other field, are never read.

const RECORD = /^[0-9]{1,10}\.json$/
const MAX_BYTES = 64 * 1024
const MAX_FILES = 512

function registryDirectory(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions')
}

/** Whether a process with this pid exists; a refusal to signal it still means it does. */
function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function readRecord(file, readFile) {
  let parsed
  try {
    const bytes = readFile(file)
    if (bytes.length > MAX_BYTES) return null
    parsed = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const { sessionId, pid } = parsed
  if (typeof sessionId !== 'string' || !Number.isSafeInteger(pid) || pid <= 0) return null
  return { sessionId, pid }
}

/**
 * `live` or `ended` when the registry names this session, '' when it says nothing.
 *
 * A session the registry does not name is no verdict: the registry knows only
 * Claude Code, and an unreadable one is the same as none, so the server's own
 * reading of the row stands.
 */
function claudeLiveness(sessionId, options = {}) {
  const directory = options.directory || registryDirectory(options.env)
  const readdir = options.readdir || ((dir) => fs.readdirSync(dir))
  const readFile = options.readFile || ((file) => fs.readFileSync(file))
  const alive = options.processAlive || processAlive
  let names
  try {
    names = readdir(directory)
  } catch {
    return ''
  }
  let named = false
  for (const name of names.filter((entry) => RECORD.test(entry)).slice(0, MAX_FILES)) {
    const record = readRecord(path.join(directory, name), readFile)
    if (record === null || record.sessionId !== sessionId) continue
    if (alive(record.pid)) return 'live'
    named = true
  }
  return named ? 'ended' : ''
}

module.exports = { claudeLiveness, processAlive, registryDirectory }
