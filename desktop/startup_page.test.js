'use strict'

/**
 * The page the window opens on. It is the owner's first answer to a click, so
 * what it promises matters: progress while the server is found, the restart
 * only for a stale managed server, and for every failure a remedy in the
 * owner's language with the raw reason underneath, never as the whole message.
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  ACTION_ORIGIN,
  renderStartupPage,
  resolveLocale,
  startupAction,
  startupPageUrl,
  startupView,
} = require('./startup_page')

test('the language follows the web UI rule: a stored choice, else any Russian system language', () => {
  assert.equal(resolveLocale('en', ['ru-RU']), 'en')
  assert.equal(resolveLocale(null, ['en-US', 'ru-RU']), 'ru')
  assert.equal(resolveLocale(null, ['de-DE']), 'en')
  assert.equal(resolveLocale('fr', []), 'en')
})

test('starting is progress with no remedy to click, in both languages', () => {
  for (const [locale, title] of [
    ['ru', 'Запускаем Valkama…'],
    ['en', 'Starting Valkama…'],
  ]) {
    const view = startupView({ phase: 'starting', locale, port: 8642 })
    assert.equal(view.title, title)
    assert.equal(view.busy, true)
    assert.deepEqual(view.actions, [])
    const html = renderStartupPage({ phase: 'starting', locale, port: 8642 })
    assert.match(html, new RegExp(`<html lang="${locale}">`))
    assert.match(html, /role="status"/)
    assert.doesNotMatch(html, new RegExp(ACTION_ORIGIN))
  }
})

test('a stale server says which half drifted and offers exactly the restart', () => {
  const view = startupView({ phase: 'stale', locale: 'ru', reasons: ['front-end', 'server-code'] })
  assert.deepEqual(view.lines.slice(0, 2), [
    'После его запуска собран новый интерфейс.',
    'После его запуска изменился код сервера.',
  ])
  assert.deepEqual(
    view.actions.map((item) => item.action),
    ['restart'],
  )
  assert.match(
    renderStartupPage({ phase: 'stale', locale: 'en', reasons: ['front-end'] }),
    /href="https:\/\/valkama\.invalid\/restart"/,
  )
})

test('a failure names the remedy for its kind, offers to try again and never a restart', () => {
  const foreign = startupView({
    phase: 'failed',
    kind: 'foreign',
    locale: 'en',
    port: 8672,
    detail: 'held by 77',
  })
  assert.match(
    foreign.lines[0],
    /Port 8672 is held by a process the Valkama launcher did not start/,
  )
  assert.deepEqual(
    foreign.actions.map((item) => item.action),
    ['retry'],
  )
  const launcher = startupView({ phase: 'failed', kind: 'launcher', locale: 'ru' })
  assert.match(launcher.lines[0], /launcher install/)
  const unknown = startupView({ phase: 'failed', kind: 'timeout', locale: 'ru' })
  assert.match(unknown.lines[0], /Повторите/)
  const html = renderStartupPage({
    phase: 'failed',
    kind: 'foreign',
    locale: 'en',
    detail: 'held by 77',
  })
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /valkama\.invalid\/restart/)
})

test('a reason from the system is shown as text, never as markup', () => {
  const html = renderStartupPage({
    phase: 'failed',
    kind: 'server-exited',
    locale: 'en',
    detail: '<img src=x onerror=alert(1)> "quoted" & more',
  })
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &quot;quoted&quot; &amp; more/)
  // The page runs no script at all; its policy says so.
  assert.match(html, /default-src 'none'/)
  assert.doesNotMatch(html, /<script/)
})

test('only the two remedy links are actions; anything else is an ordinary navigation', () => {
  assert.equal(startupAction(`${ACTION_ORIGIN}restart`), 'restart')
  assert.equal(startupAction(`${ACTION_ORIGIN}retry`), 'retry')
  for (const url of [
    `${ACTION_ORIGIN}stop`,
    `${ACTION_ORIGIN}restart?x=1`,
    'https://valkama.invalid.example/restart',
    'http://127.0.0.1:8642/',
    undefined,
  ]) {
    assert.equal(startupAction(url), null, String(url))
  }
})

test('the page travels as one data URL the window can load without a server', () => {
  const url = startupPageUrl({ phase: 'starting', locale: 'ru', port: 8642 })
  assert.ok(url.startsWith('data:text/html;charset=utf-8,'))
  assert.match(decodeURIComponent(url.slice(url.indexOf(',') + 1)), /Запускаем Valkama…/)
})

test('while it waits the page draws the shell at the rail width the reader last chose', () => {
  const chosen = renderStartupPage({ phase: 'starting', locale: 'en', navWidth: 319.6 })
  assert.match(chosen, /--sk-chosen: 320px;/)
  assert.match(chosen, /class="sk-rail"/)
  assert.match(chosen, /aria-busy="true"/)
  // Nothing remembered, or nothing usable: the rail falls back to the shell's default.
  for (const navWidth of [undefined, null, 'wide', 0, -40]) {
    const fallback = renderStartupPage({ phase: 'starting', locale: 'en', navWidth })
    assert.doesNotMatch(fallback, /--sk-chosen:/, String(navWidth))
    assert.match(fallback, /var\(--sk-chosen, 260px\)/)
  }
  // A failure is no wait: it is the plain page with its remedy, and no skeleton.
  const failed = renderStartupPage({ phase: 'failed', kind: 'launcher', locale: 'en', navWidth: 320 })
  assert.doesNotMatch(failed, /sk-rail/)
})

test('a start says what it waits for only once the wait is long enough to read; a restart at once', () => {
  const starting = renderStartupPage({ phase: 'starting', locale: 'ru' })
  assert.match(starting, /\.sk-status \{[^}]*animation: appear 160ms ease-out 1000ms both;/)
  const restarting = renderStartupPage({ phase: 'restarting', locale: 'ru' })
  assert.match(restarting, /\.sk-status \{[^}]*animation: appear 160ms ease-out 0ms both;/)
  assert.match(restarting, /Перезапускаем сервер…/)
  for (const html of [starting, restarting]) {
    assert.match(html, /@media \(prefers-reduced-motion: reduce\)/)
    assert.doesNotMatch(html, new RegExp(ACTION_ORIGIN))
  }
})
