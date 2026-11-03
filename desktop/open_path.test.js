'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { howToOpen, openPathFromArgv, openPathUrl, refusesLaunch } = require('./open_path')

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

test('the listener may also send the window to the panel of questions', () => {
  const route = '/modules/planning/global?panel=questions'
  assert.equal(openPathFromArgv(['Valkama.exe', `--open-path=${route}`]), route)
  for (const refused of [`${route}&x=1`, `${route}2`, '/modules/planning/global?panel=other']) {
    assert.equal(openPathFromArgv(['Valkama.exe', `--open-path=${refused}`]), null, refused)
  }
})

test('a toast names an item or the panel, and either reaches the window as a route', () => {
  assert.equal(
    openPathFromArgv(['Valkama.exe', 'valkama://open/MAIN-12']),
    '/open/MAIN-12?in=browser',
  )
  assert.equal(
    openPathFromArgv(['Valkama.exe', 'valkama://open/questions']),
    '/modules/planning/global?panel=questions',
  )
  // Electron documents that a second instance's argv may be reordered and extended.
  assert.equal(
    openPathFromArgv(['Valkama.exe', '--no-sandbox', 'valkama://open/MAIN-12', '--flag']),
    '/open/MAIN-12?in=browser',
  )
  // A space may be called QUESTION and keep its items.
  assert.equal(
    openPathFromArgv(['Valkama.exe', 'valkama://open/QUESTION-1']),
    '/open/QUESTION-1?in=browser',
  )
  assert.equal(refusesLaunch(['Valkama.exe', 'valkama://open/MAIN-12']), false)
  assert.equal(refusesLaunch(['Valkama.exe', 'valkama://open/questions']), false)
})

test('any other scheme address opens nothing, and the launch does not touch the window', () => {
  for (const address of [
    'valkama:',
    'valkama://',
    'valkama://open',
    'valkama://open/',
    'valkama://evil.example/MAIN-12', // a foreign host
    'valkama://evil.example/open/MAIN-12',
    'valkama://open.evil.example/MAIN-12',
    'valkama://user@open/MAIN-12',
    'valkama://open:80/MAIN-12',
    'valkama:///open/MAIN-12',
    'valkama:open/MAIN-12',
    'valkama://open/MAIN-12/', // an extra path
    'valkama://open/MAIN-12/x',
    'valkama://open/questions/x',
    'valkama://open//MAIN-12',
    'valkama://open/../open/MAIN-12',
    'valkama://open/MAIN-12?x=1', // a query
    'valkama://open/questions?in=browser',
    'valkama://open/MAIN-12#x', // a fragment
    'valkama://open/questions#x',
    'valkama://open/MAIN-0',
    'valkama://open/MAIN',
    'valkama://open/main-12',
    'valkama://open/QUESTIONS',
    'valkama://open/Questions',
    'valkama://open/MAIN%2D12',
    'valkama://open/MAIN-12%0d%0a',
    'valkama://open/MAIN-12\n',
    'valkama://open/https:%2F%2Fevil.example',
    'VALKAMA://open/MAIN-12',
    'valkama://open/MAIN-12 ',
  ]) {
    assert.equal(openPathFromArgv(['Valkama.exe', address]), null, address)
    assert.equal(refusesLaunch(['Valkama.exe', address]), true, address)
  }
})

test('other schemes are no business of this launch', () => {
  for (const argument of ['https://evil.example/MAIN-12', 'file:///C:/x', 'valkamax://open/MAIN-1']) {
    assert.equal(openPathFromArgv(['Valkama.exe', argument]), null, argument)
    assert.equal(refusesLaunch(['Valkama.exe', argument]), false, argument)
  }
  assert.equal(refusesLaunch(['Valkama.exe']), false)
  assert.equal(refusesLaunch(undefined), false)
  assert.equal(refusesLaunch([`--open-path=${ROUTE}`]), false)
})

test('an address that was split or doubled is no answer rather than a guess', () => {
  // Windows can split an address with a quote in it, which is how a page adds a switch.
  for (const argv of [
    ['Valkama.exe', 'valkama://open/MAIN-1', `--open-path=${ROUTE}`],
    ['Valkama.exe', 'valkama://open/MAIN-1', 'valkama://open/MAIN-2'],
    ['Valkama.exe', 'valkama://open/MAIN-1', 'valkama://open/MAIN-1'],
    ['Valkama.exe', 'valkama://open/MAIN-1', '--open-path=/x'],
  ]) {
    assert.equal(openPathFromArgv(argv), null, argv.join(' '))
    assert.equal(refusesLaunch(argv), true, argv.join(' '))
  }
})

test('the installer registers the scheme for this user and an uninstall removes it', () => {
  const builder = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf8')).build
  // electron-builder 26 reads `protocols` for macOS, AppX and Linux, never for NSIS.
  assert.equal(builder.nsis.include, 'build/installer.nsh')
  assert.equal(builder.nsis.perMachine, false)
  const script = readFileSync(path.join(__dirname, builder.nsis.include), 'utf8')
  const root = 'HKCU "Software\\Classes\\valkama'
  assert.ok(script.includes(`WriteRegStr ${root}" "URL Protocol" ""`))
  // Quoted, or a space in the address becomes another argument of the app's own making.
  assert.ok(
    script.includes(
      `WriteRegStr ${root}\\shell\\open\\command" "" '"$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" "%1"'`,
    ),
  )
  assert.match(script, /!macro customUnInstall[\s\S]*DeleteRegKey HKCU "Software\\Classes\\valkama"/)
})

test('a refused launch stops before it can reach a running window', () => {
  const main = readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  const refused = main.indexOf('refusesLaunch(process.argv)')
  assert.notEqual(refused, -1)
  assert.ok(refused < main.indexOf('app.requestSingleInstanceLock()'))
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
