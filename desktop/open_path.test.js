'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { howToOpen, openPathFromArgv, openPathUrl } = require('./open_path')

// A route worked out by hand from the grammar; tests/test_work_item_link.py holds
// the same literal and web/tests/platformRoute.test.ts reads it with the browser's
// parser, so all three languages agree on one spelling without sharing code.
const ROUTE =
  '/modules/planning/project/example-project?entity=' +
  'eyJraW5kIjoid29yay1pdGVtIiwicmVzb3VyY2VfaWQiOiJleUp5WldabGNtVnVZMlVpT2lKTlFVbE9MVEV5SWl3aWMz' +
  'QmhZMlZmY21WbUlqcDdJbVJoZEdGZmMyTnZjR1ZmYVdRaU9pSXdNVEl6TkRVMk55MDRPV0ZpTFRSa1pXWXRPREV5TXkw' +
  'ME5UWTNPRGxoWW1Oa1pXWWlMQ0p6Y0dGalpWOXJaWGtpT2lKTlFVbE9JbjE5In0'

test('the route the listener issues is read wherever it stands in a command line', () => {
  const asked = `--open-path=${ROUTE}`
  assert.equal(openPathFromArgv(['Valkama.exe', asked]), ROUTE)
  // Electron documents that a second instance's argv may be reordered and extended.
  assert.equal(
    openPathFromArgv(['Valkama.exe', '--allow-file-access-from-files', asked, '--no-sandbox']),
    ROUTE,
  )
  assert.equal(openPathFromArgv(['electron.exe', '.', asked]), ROUTE)
})

test('a launch without an address asks for nothing', () => {
  assert.equal(openPathFromArgv(['Valkama.exe']), null)
  assert.equal(openPathFromArgv(['Valkama.exe', '--open-pathway=/x', '--open-path']), null)
  assert.equal(openPathFromArgv([]), null)
  assert.equal(openPathFromArgv(undefined), null)
  assert.equal(openPathFromArgv('--open-path=/x'), null)
})

test('anything but one card route on this origin is ignored', () => {
  for (const route of [
    '',
    '/',
    '/open/MAIN-12',
    '/modules/planning/global',
    '/modules/planning/project/example-project',
    '/modules/planning/project/example-project?entity=',
    '/modules/settings/global?entity=abc',
    '//evil.example/modules/planning/project/example-project?entity=abc',
    'https://evil.example/modules/planning/project/example-project?entity=abc',
    'javascript:alert(1)',
    '/modules/planning/project/../../api/doctor?entity=abc',
    '/modules/planning/project/Example?entity=abc',
    '/modules/planning/project/example-project?entity=abc&other=1',
    '/modules/planning/project/example-project?entity=abc#//evil.example',
    '/modules/planning/project/example-project?entity=abc\r\nHost: evil.example',
    '/modules/planning/project/example-project?entity=abc\n',
    ` ${ROUTE}`,
    `${ROUTE} `,
  ]) {
    assert.equal(openPathFromArgv(['Valkama.exe', `--open-path=${route}`]), null, route)
  }
})

test('two addresses in one command line are no answer rather than a guess', () => {
  assert.equal(openPathFromArgv(['Valkama.exe', `--open-path=${ROUTE}`, '--open-path=/x']), null)
  assert.equal(openPathFromArgv(['Valkama.exe', `--open-path=${ROUTE}`, `--open-path=${ROUTE}`]), null)
})

test('a route stays on the origin the window already serves', () => {
  const url = new globalThis.URL(openPathUrl('http://127.0.0.1:8642/', ROUTE))
  assert.equal(url.origin, 'http://127.0.0.1:8642')
  assert.equal(`${url.pathname}${url.search}`, ROUTE)
})

test('a route waits for the page, goes to a page that listens, and loads otherwise', () => {
  // The starting page has no router and no draft; Valkama will load the address.
  assert.equal(howToOpen({ showingValkama: false, pageListens: false }), 'wait')
  assert.equal(howToOpen({ showingValkama: false, pageListens: true }), 'wait')
  // A reload here is what loses a comment being written.
  assert.equal(howToOpen({ showingValkama: true, pageListens: true }), 'hand-over')
  // An older bundle or a renderer that is gone cannot take it.
  assert.equal(howToOpen({ showingValkama: true, pageListens: false }), 'load')
})

test('the window hands a route over only to the page that said it listens', () => {
  const main = readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  assert.match(main, /ipcMain\.on\('valkama:open-route-ready'/)
  // A page that navigated away or died no longer listens, whatever it said.
  assert.match(main, /'did-start-navigation'/)
  assert.match(main, /'render-process-gone'/)
  assert.match(main, /webContents\.send\('valkama:open-route', requestedPath\)/)
})

test('the window reads the address at first start and on a second launch', () => {
  // The wiring is what a unit test of the parser cannot see, and a window that
  // stopped reading one of the two would still open.
  const main = readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  assert.match(main, /openPathFromArgv\(process\.argv\)/)
  assert.match(main, /app\.on\('second-instance', \(_event, argv\) =>/)
  assert.match(main, /openPathFromArgv\(argv\)/)
})
