import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import {
  NAV_DEFAULT_WIDTH,
  NAV_ICONS_ONLY_WIDTH,
  NAV_MAX_WIDTH,
  NAV_MIN_WIDTH,
  NAV_WIDTH_STORAGE_KEY,
  NAV_WORKSPACE_ROOM,
} from '../src/shared/lib/shellLayout'

/**
 * One skeleton, two pages.
 *
 * The desktop window draws the shell's skeleton from a data URL while the server is
 * found (`desktop/startup_page.js`), and `index.html` draws it again until the
 * application mounts over it. The two follow each other on screen, so a rule that
 * differs between them is a jump the reader sees, and both stand where the shell will,
 * so the rail obeys the shell's own width rule. The data URL resolves no custom
 * property: its colours are the literals `scripts/sync-tokens.mjs` writes, and the
 * index page's tokens are compared through the same map.
 */
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const load = createRequire(import.meta.url)
const startupPage = load('../../desktop/startup_page.js') as {
  PAGE_COLORS: Record<string, string>
  renderStartupPage: (state: Record<string, unknown>) => string
}
const startupSource = read('../../desktop/startup_page.js')
const index = read('../index.html')

/** `--color-x` → the literal the startup page carries for it. */
function tokenLiterals(): Map<string, string> {
  const block = /const PAGE_TOKENS = \{([\s\S]*?)\n\}/.exec(startupSource)
  assert.ok(block, 'startup_page.js no longer declares PAGE_TOKENS')
  const literals = new Map<string, string>()
  for (const [, key, token] of block[1].matchAll(/(\w+): '(--[\w-]+)'/g)) {
    const literal = startupPage.PAGE_COLORS[key]
    assert.ok(literal, `PAGE_COLORS has no ${key}`)
    literals.set(token, literal)
  }
  return literals
}

/** Every rule of a stylesheet, keyed by its at-rule context and selector, declarations sorted. */
function rules(css: string): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const context: string[] = []
  let text = ''
  for (const char of css.replaceAll(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') {
      context.push(text.trim().replaceAll(/\s+/g, ' '))
      text = ''
    } else if (char === '}') {
      const declarations = text
        .split(';')
        .map((each) => each.trim().replaceAll(/\s+/g, ' '))
        .filter(Boolean)
      if (declarations.length > 0) found.set(context.join(' › '), declarations.toSorted())
      context.pop()
      text = ''
    } else {
      text += char
    }
  }
  return found
}

function styleOf(html: string): string {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)
  assert.ok(style, 'the page has no stylesheet')
  return style[1]
}

/**
 * What the window draws and the index page does not: its own ground and the status
 * line it prints over the skeleton while the server is found. Every other rule of
 * either page is the skeleton, whatever its selector is called.
 */
const WINDOW_ONLY = new Set([
  '*',
  'html, body',
  'body',
  'h1',
  'h1::before',
  'p',
  '.sk-status',
  '@keyframes appear › from',
  '@keyframes spin › to',
  '@media (prefers-reduced-motion: reduce) › .sk-status',
  '@media (prefers-reduced-motion: reduce) › h1::before',
])
/** Every rule both pages must draw alike: all of a page's rules but the window's own. */
function skeletonRules(css: string): Record<string, string[]> {
  return Object.fromEntries(
    [...rules(css)]
      .filter(([key]) => !WINDOW_ONLY.has(key))
      .map(([key, declarations]) => [
        key,
        // The index page takes its colour scheme from the application's stylesheet.
        key === ':root'
          ? declarations.filter((each) => !each.startsWith('color-scheme:'))
          : declarations,
      ]),
  )
}

const RAIL = `--sk-rail: clamp(${NAV_MIN_WIDTH}px, var(--sk-chosen, ${NAV_DEFAULT_WIDTH}px), max(${NAV_MIN_WIDTH}px, min(${NAV_MAX_WIDTH}px, 100vw - ${NAV_WORKSPACE_ROOM}px)))`

test('the window and the index page draw the skeleton with the same rules and colours', () => {
  const literals = tokenLiterals()
  const windowCss = styleOf(startupPage.renderStartupPage({ phase: 'starting', locale: 'en' }))
  // The window's own rules are named exactly: one the window lost, or one the index page
  // draws too, would leave a skeleton rule out of the comparison.
  for (const key of WINDOW_ONLY) {
    assert.ok(rules(windowCss).has(key), `the window no longer draws ${key}`)
    assert.ok(!rules(styleOf(index)).has(key), `index.html draws ${key}: it is skeleton`)
  }
  const desktop = skeletonRules(windowCss)
  const browser = skeletonRules(
    styleOf(index).replaceAll(/var\((--color-[\w-]+)\)/g, (_match, token: string) => {
      const literal = literals.get(token)
      assert.ok(
        literal,
        `index.html colours the skeleton with ${token}, which the startup page lacks`,
      )
      return literal
    }),
  )
  assert.ok(Object.keys(desktop).length > 10, 'the startup page no longer draws a skeleton')
  assert.deepEqual(browser, desktop)
})

test('the skeleton’s rail obeys the shell’s width rule and its icons-only form', () => {
  for (const [name, css] of [
    [
      'startup_page.js',
      styleOf(startupPage.renderStartupPage({ phase: 'starting', locale: 'ru' })),
    ],
    ['index.html', styleOf(index)],
  ] as const) {
    assert.ok(rules(css).get(':root')?.includes(RAIL), `${name} sizes the rail another way`)
    assert.ok(
      rules(css).has(`@media (width <= ${NAV_ICONS_ONLY_WIDTH}px) › :root`),
      `${name} no longer draws the rail as icons where the shell does`,
    )
  }
  // The context bar stacks its title over its controls in one column below a width
  // of the workspace; the skeleton's bar stacks at the same one.
  const contextBar = read('../src/app/components/AppContextBar.vue')
  const wrap =
    /@container main \(width <= (\d+)px\) \{\s*\.context-bar \{\s*grid-template-columns: minmax\(0, 1fr\);/.exec(
      contextBar,
    )
  assert.ok(wrap, 'AppContextBar.vue no longer stacks the bar at a container width')
  for (const [name, css] of [
    [
      'startup_page.js',
      styleOf(startupPage.renderStartupPage({ phase: 'starting', locale: 'en' })),
    ],
    ['index.html', styleOf(index)],
  ] as const) {
    assert.ok(
      rules(css).has(`@container sk-main (width <= ${wrap[1]}px) › .sk-bar`),
      `${name} stacks the bar at another width`,
    )
  }
})

test('both pages read the rail width and the language from the keys the shell writes', () => {
  assert.ok(index.includes(`localStorage.getItem('${NAV_WIDTH_STORAGE_KEY}')`))
  // The window hears them from its preload, which reads the page's storage by these keys.
  const preload = read('../../desktop/preload.js')
  assert.ok(preload.includes(`navWidth: '${NAV_WIDTH_STORAGE_KEY}'`))
  const i18n = read('../src/shared/i18n/index.ts')
  const locale = /localStorage\.getItem\('([\w-]+)'\)/.exec(i18n)
  assert.ok(locale, 'the shell no longer reads its language from storage')
  assert.ok(preload.includes(`locale: '${locale[1]}'`))
})
