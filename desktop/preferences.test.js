'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { preferencesAfter, readPreferences, rememberPreferences } = require('./preferences')
const { renderStartupPage } = require('./startup_page')

/** A preferences file in memory: what was read, and every write in order. */
function memoryFile(initial) {
  const writes = []
  let content = initial
  return {
    writes,
    io: {
      read() {
        if (content === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        return content
      },
      write(_file, text) {
        writes.push(text)
        content = text
      },
    },
  }
}

test('nothing remembered is no preference, and the starting page draws the default rail', () => {
  for (const content of [undefined, '', 'not json', '[1, 2]']) {
    const { io } = memoryFile(content)
    const remembered = readPreferences('valkama-desktop.json', io.read)
    assert.deepEqual(remembered, {}, String(content))
    const page = renderStartupPage({ phase: 'starting', locale: 'en', navWidth: remembered.navWidth })
    assert.doesNotMatch(page, /--sk-chosen:/)
    assert.match(page, /var\(--sk-chosen, 260px\)/)
  }
})

test('a width the reader sets is kept beside the language, and the next start draws it', () => {
  const file = memoryFile(`${JSON.stringify({ locale: 'ru' })}\n`)
  assert.equal(rememberPreferences('f', { locale: 'ru', navWidth: '319.6' }, file.io), true)
  assert.deepEqual(JSON.parse(file.writes[0]), { locale: 'ru', navWidth: 320 })
  const page = renderStartupPage({
    phase: 'starting',
    locale: 'ru',
    navWidth: readPreferences('f', file.io.read).navWidth,
  })
  assert.match(page, /--sk-chosen: 320px;/)

  // Changed again, it is kept again: the file follows the reader, not the first load.
  assert.equal(rememberPreferences('f', { locale: 'ru', navWidth: '480' }, file.io), true)
  assert.deepEqual(JSON.parse(file.writes[1]), { locale: 'ru', navWidth: 480 })
})

test('a report that changes nothing writes nothing', () => {
  const file = memoryFile(`${JSON.stringify({ locale: 'en', navWidth: 300 })}\n`)
  assert.equal(rememberPreferences('f', { locale: 'en', navWidth: '300' }, file.io), false)
  assert.deepEqual(file.writes, [])
})

test('a value the page has not stored, or one the window cannot use, keeps what was remembered', () => {
  const current = { locale: 'ru', navWidth: 320 }
  for (const reported of [
    { locale: null, navWidth: null },
    { locale: 'de', navWidth: 'wide' },
    { locale: '', navWidth: '' },
    { navWidth: '0' },
    { navWidth: '-40' },
    { navWidth: 'Infinity' },
    { navWidth: 320 },
    null,
    'not a report',
  ]) {
    assert.equal(preferencesAfter(current, reported), null, JSON.stringify(reported))
  }
  // Another key the file holds survives a write.
  assert.deepEqual(preferencesAfter({ other: true }, { locale: 'en', navWidth: null }), {
    other: true,
    locale: 'en',
  })
})
