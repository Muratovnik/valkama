'use strict'

// One line per step of opening the window, beside the tray's log in %TEMP%.
// The tray's `valkama-tray.log` is where a support question about a click
// already starts, and the packaged app had no log at all: what it wrote to the
// console vanished. A file of its own beside that one keeps two writers out of
// one file, and both write UTC instants, so the click and the window it opened
// line up across the two.

const { appendFileSync, renameSync, statSync } = require('node:fs')
const path = require('node:path')

const LOG_NAME = 'valkama-desktop.log'
const ROTATE_BYTES = 1024 * 1024

function formatField(value) {
  const text = String(value)
  return /[\s"]/.test(text) ? JSON.stringify(text) : text
}

/**
 * A logger for one app process. Each line is
 * `<UTC instant> desktop[<pid>] <event> +<ms since the exe started> key=value…`,
 * so a step's cost is the difference of two lines and the exe's own start is
 * the zero every line counts from.
 */
function createStartupLog({ directory, pid, startedAt, now = Date.now, write, rotate }) {
  const file = directory ? path.join(directory, LOG_NAME) : ''
  const append = write || ((line) => appendFileSync(file, line))
  if (file && !write) {
    try {
      if (statSync(file).size > ROTATE_BYTES) (rotate || renameSync)(file, `${file}.1`)
    } catch {
      // No log yet, or another process holds it: nothing to rotate.
    }
  }
  return function log(event, fields = {}) {
    if (!file && !write) return
    const at = now()
    const extra = Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${formatField(value)}`)
    const line = [
      new Date(at).toISOString(),
      `desktop[${pid}]`,
      event,
      `+${Math.round(at - startedAt)}ms`,
      ...extra,
    ].join(' ')
    try {
      append(`${line}\n`)
    } catch {
      // A log must never be why a window does not open.
    }
  }
}

module.exports = { LOG_NAME, createStartupLog }
