'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { contextMenuTemplate, pageLocale } = require('./context_menu')

// A right click's parameters as Electron hands them over, with nothing under it.
const NOTHING = {
  linkURL: '',
  selectionText: '',
  isEditable: false,
  editFlags: {
    canCut: false,
    canCopy: false,
    canPaste: false,
    canSelectAll: false,
  },
}

/** What the menu shows: a label, its role or `click`, and `-` for a separator. */
function shown(template) {
  return template.map((item) => {
    if (item.type === 'separator') return '-'
    const kind = item.role ?? (typeof item.click === 'function' ? 'click' : '?')
    return item.enabled === false ? `${item.label} (${kind}, off)` : `${item.label} (${kind})`
  })
}

test('a link offers its address, and pressing it copies exactly that address', () => {
  const copied = []
  const address = 'http://127.0.0.1:8642/open/MAIN-12'
  const template = contextMenuTemplate({ ...NOTHING, linkURL: address }, 'en', (text) =>
    copied.push(text),
  )
  assert.deepEqual(shown(template), ['Copy link address (click)'])
  template[0].click()
  assert.deepEqual(copied, [address])
})

test('selected text offers Copy through the editing role', () => {
  const template = contextMenuTemplate({ ...NOTHING, selectionText: 'MAIN-12' }, 'en', () => {})
  assert.deepEqual(shown(template), ['Copy (copy)'])
})

test('selected link text offers both, the address first', () => {
  const template = contextMenuTemplate(
    { ...NOTHING, linkURL: 'https://example.com/', selectionText: 'example' },
    'en',
    () => {},
  )
  assert.deepEqual(shown(template), ['Copy link address (click)', '-', 'Copy (copy)'])
})

test('a field offers the editing four, each enabled as the field allows', () => {
  const template = contextMenuTemplate(
    {
      ...NOTHING,
      isEditable: true,
      selectionText: '',
      editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
    },
    'en',
    () => {},
  )
  assert.deepEqual(shown(template), [
    'Cut (cut, off)',
    'Copy (copy, off)',
    'Paste (paste)',
    '-',
    'Select all (selectAll)',
  ])
})

test('a field with a selection does not add a second Copy', () => {
  const template = contextMenuTemplate(
    {
      ...NOTHING,
      isEditable: true,
      selectionText: 'draft',
      editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    },
    'en',
    () => {},
  )
  assert.equal(template.filter((item) => item.role === 'copy').length, 1)
})

test('a click on nothing it can act on opens no menu', () => {
  assert.deepEqual(
    contextMenuTemplate(NOTHING, 'en', () => {}),
    [],
  )
  // Whitespace selected between two blocks is nothing to copy.
  assert.deepEqual(
    contextMenuTemplate({ ...NOTHING, selectionText: ' \n' }, 'en', () => {}),
    [],
  )
})

test('the labels speak the language of the interface', () => {
  const template = contextMenuTemplate(
    {
      ...NOTHING,
      linkURL: 'https://example.com/',
      isEditable: true,
      editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
    },
    'ru',
    () => {},
  )
  assert.deepEqual(shown(template), [
    'Копировать адрес ссылки (click)',
    '-',
    'Вырезать (cut)',
    'Копировать (copy)',
    'Вставить (paste)',
    '-',
    'Выделить всё (selectAll)',
  ])
  // A language the interface does not have falls back to English rather than to nothing.
  assert.deepEqual(shown(contextMenuTemplate({ ...NOTHING, selectionText: 'x' }, 'de', () => {})), [
    'Copy (copy)',
  ])
})

test("the page's language is taken only when it is one of the interface's", () => {
  assert.equal(pageLocale('ru'), 'ru')
  assert.equal(pageLocale('en'), 'en')
  for (const lang of ['', 'ru-RU', 'de', undefined, null, 42]) assert.equal(pageLocale(lang), null)
})

test('the window builds the menu on every right click and copies through the clipboard', () => {
  // The wiring is what a test of the template cannot see: a window that stopped
  // listening would still open, with no menu anywhere.
  const main = readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  // `window_policy.test.js` holds the listener; here it is every window's.
  assert.match(main, /guardWindow\(contents, \{[^}]*showContextMenu,/)
  assert.match(main, /Menu\.buildFromTemplate\(template\)\.popup\(/)
  assert.match(main, /clipboard\.writeText\(text\)/)
  assert.match(main, /document\.documentElement\.lang/)
})
