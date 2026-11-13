'use strict'

// The workspace keeps its language and the width of its rail in the page's own
// storage, which the window cannot read before the page exists. The starting page
// needs both from its first frame, so the window keeps a copy of what the page last
// reported (`preload.js` reports it as it changes) in one small file of its own.

const { readFileSync, writeFileSync } = require('node:fs')

const { parseJsonObject } = require('./runtime_contract')

/** What the file holds, or nothing remembered when it is missing or unreadable. */
function readPreferences(file, read = readFileSync) {
  try {
    return parseJsonObject(read(file, 'utf8')) ?? {}
  } catch {
    // First start, or unreadable: the system languages and the default rail decide.
    return {}
  }
}

/**
 * The preferences after a page's report, or null when the report changes nothing.
 *
 * A report carries the page's stored values as the page stores them: a locale, and
 * the rail width as text (or a number). A value the page has not stored, or one the window could not
 * use, leaves what the window remembered as it was.
 */
function preferencesAfter(current, reported) {
  const next = { ...current }
  const locale = reported?.locale
  if (locale === 'en' || locale === 'ru') next.locale = locale
  const stored = reported?.navWidth
  const width =
    typeof stored === 'number' || (typeof stored === 'string' && stored.trim())
      ? Number(stored)
      : Number.NaN
  if (Number.isFinite(width) && width > 0) next.navWidth = Math.round(width)
  return next.locale === current.locale && next.navWidth === current.navWidth ? null : next
}

/** Keep what a page reported; true when the file changed. */
function rememberPreferences(file, reported, io = { read: readFileSync, write: writeFileSync }) {
  const next = preferencesAfter(readPreferences(file, io.read), reported)
  if (next === null) return false
  io.write(file, `${JSON.stringify(next)}\n`, 'utf8')
  return true
}

module.exports = { preferencesAfter, readPreferences, rememberPreferences }
