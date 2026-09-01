/**
 * `tokens.css` is the palette; every other copy of a token is generated from it.
 *
 * Copies exist for reasons that will not go away: a canvas chart resolves no
 * custom property, a browser tab and a Windows ICO resolve none either, the
 * Electron window paints before the stylesheet loads, and DESIGN.md has to
 * state the palette to be readable as a design document. Seven of them, and
 * every one has drifted at least once — the chart blue and the token blue were
 * two different blues for months.
 *
 * Tests already caught that drift. What they could not do is fix it, so a
 * palette change meant editing seven files by hand and running the suite to
 * find the one that was missed. This script writes them instead, and `--check`
 * fails the gate when a mirror no longer matches what it mirrors.
 *
 * Every site names an anchor that must match exactly once. A moved anchor is a
 * loud failure rather than a silent no-op, which is the failure mode a
 * find-and-replace script normally has.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = new URL('../../', import.meta.url)
const read = (relative) => readFileSync(fileURLToPath(new URL(relative, repoRoot)), 'utf8')

/**
 * Every declaration in `:root`, as written and as resolved.
 *
 * Both halves are load-bearing. The resolved value is what a mirror copies; the
 * declared one is what says which tier a token belongs to, because a primitive
 * spells a value and a semantic token spells `var(…)`. Only the whole-value
 * reference resolves — `--shadow-overlay` and `--size-page-gutter` are expressions
 * that happen to contain none, and one that did would not be mirrorable anyway.
 */
export function readTokens(css = read('web/src/app/styles/tokens.css')) {
  const root = /:root\s*\{([\s\S]*)\n\}/.exec(css)
  if (!root) throw new Error('tokens.css no longer declares a :root block')
  const declared = new Map()
  for (const [, name, written] of root[1].matchAll(/^\s*(--[a-z][\w-]*)\s*:\s*([^;]+);/gm)) {
    declared.set(name, written.trim())
  }
  const tokens = new Map()
  const resolve = (name, seen = new Set()) => {
    if (tokens.has(name)) return tokens.get(name).value
    if (seen.has(name)) throw new Error(`${name} resolves through itself`)
    const written = declared.get(name)
    if (written === undefined) throw new Error(`${name} is missing from tokens.css`)
    const reference = /^var\(\s*(--[a-z][\w-]*)\s*\)$/.exec(written)
    const resolved = reference ? resolve(reference[1], new Set([...seen, name])) : written
    tokens.set(name, { declared: written, value: resolved })
    return resolved
  }
  for (const name of declared.keys()) resolve(name)
  return tokens
}

/** A token's resolved value, or a loud failure naming the site that wanted it. */
const value = (tokens, name, where) => {
  const found = tokens.get(name)
  if (!found) throw new Error(`${where} wants ${name}, which tokens.css does not declare`)
  return found.value
}

/** `#ececec` as the channel triple an ICO is written in. */
function hexTriple(hex) {
  const digits = hex.replace('#', '')
  return [0, 2, 4].map((offset) => `0x${digits.slice(offset, offset + 2).toUpperCase()}`).join(', ')
}

/** The body of `const <name> = { … }` or `= [ … ]`, which none of these nest. */
function bodyOf(source, name, open = '\\{', close = '\\}') {
  const match = new RegExp(`const ${name}\\b[^=]*=\\s*${open}([^${close}]*)${close}`).exec(source)
  if (!match) throw new Error(`${name} is no longer a flat literal`)
  return match[1]
}

/** The `key: '--token'` pairs a mirror declares about itself. */
function tokenMap(source, name) {
  return new Map(
    [...bodyOf(source, name).matchAll(/(\w+):\s*'(--[a-z][\w-]*)'/g)].map(([, key, token]) => [
      key,
      token,
    ]),
  )
}

/**
 * Rewrite `key: '<literal>'` inside one object body from a key→token map.
 *
 * The key sets have to match exactly, in both directions. A key in the map with
 * no literal is a mapping that rewrites nothing; a literal with no mapping is
 * worse — the generator would step around it in silence, and a color added to a
 * mirror without a token would be the one value in the app that never follows
 * the palette again. That is the failure this whole script exists to end, so it
 * is the one thing it refuses to do quietly.
 */
function keyedLiterals(body, map, tokens, format = (raw) => raw) {
  const spelled = new Set([...body.matchAll(/(\w+):\s*'/g)].map(([, key]) => key))
  const unmapped = [...spelled].filter((key) => !map.has(key))
  const unspelled = [...map.keys()].filter((key) => !spelled.has(key))
  if (unmapped.length || unspelled.length) {
    throw new Error(
      `the token map and the literals disagree: ${
        unmapped.length ? `no token for ${unmapped.join(', ')}` : ''
      }${unmapped.length && unspelled.length ? '; ' : ''}${
        unspelled.length ? `no literal for ${unspelled.join(', ')}` : ''
      }`,
    )
  }
  let next = body
  for (const [key, token] of map) {
    const site = new RegExp(`(\\b${key}:\\s*')([^']*)(')`)
    next = next.replace(
      site,
      (_, head, __, tail) => head + format(value(tokens, token, key)) + tail,
    )
  }
  return next
}

/** Rewrite a positional array of literals from a parallel array of token names. */
function positionalLiterals(body, names, tokens) {
  const literals = [...body.matchAll(/'([^']*)'/g)]
  if (literals.length !== names.length) {
    throw new Error(`expected ${names.length} literals, found ${literals.length}`)
  }
  let index = 0
  return body.replaceAll(/'([^']*)'/g, () => `'${value(tokens, names[index], names[index++])}'`)
}

/**
 * The type ramp: every `--font-size-*` that declares a length.
 *
 * The prefix used to be `--text-`, which carried the ramp and the text tones at
 * once, so a length filter was the only thing separating a size from a colour.
 * The namespace does that now and the second filter answers a different
 * question: it has to be the declared length rather than the resolved one, so
 * that anything pointed at a ramp step counts as the step it names rather than
 * as a second size of its own. The aliases that made this concrete are gone;
 * the filter stays, because the next one would be silent.
 */
const rampSteps = (tokens) =>
  [...tokens].filter(
    ([name, token]) => name.startsWith('--font-size-') && /^\d+px$/.test(token.declared),
  )

const MIRRORS = [
  {
    file: 'web/src/widgets/analytics-dashboard/utils/chartOptions.ts',
    sites: [
      {
        anchor: /const ANALYTICS_CHART_THEME = \{([^}]*)\}/,
        replace: (tokens, source) =>
          keyedLiterals(
            bodyOf(source, 'ANALYTICS_CHART_THEME'),
            tokenMap(source, 'ANALYTICS_CHART_THEME_TOKENS'),
            tokens,
          ),
      },
      {
        anchor: /const CHART_SERIES_PALETTE = \[([^\]]*)\]/,
        replace: (tokens, source) =>
          positionalLiterals(
            bodyOf(source, 'CHART_SERIES_PALETTE', '\\[', '\\]'),
            [
              ...bodyOf(source, 'CHART_SERIES_TOKENS', '\\[', '\\]').matchAll(/'(--[a-z\d-]+)'/g),
            ].map(([, name]) => name),
            tokens,
          ),
      },
      {
        anchor: /const CHART_FONT_FAMILY = "([^"]*)"/,
        replace: (tokens) => value(tokens, '--font-family-interface', 'CHART_FONT_FAMILY'),
      },
    ],
  },
  {
    file: 'web/src/shared/lib/uiSystem.ts',
    sites: [
      {
        anchor: /const SEMANTIC_TONE_COLORS: Record<SemanticTone, string> = \{([^}]*)\}/,
        replace: (tokens, source) =>
          keyedLiterals(
            bodyOf(source, 'SEMANTIC_TONE_COLORS'),
            tokenMap(source, 'SEMANTIC_TONE_TOKENS'),
            tokens,
          ),
      },
    ],
  },
  {
    // The tile the mark stands on is a primitive step on purpose. It is not the
    // chrome: an OS surface has to keep a neutral ground when the application's
    // own chrome takes a tint, so it names the ramp rather than a zone.
    file: 'windows/make_icon.py',
    sites: [
      {
        anchor: /BACKGROUND = \(([^)]*)\)/,
        replace: (tokens) => hexTriple(value(tokens, '--color-gray-900', 'BACKGROUND')),
      },
      {
        anchor: /\(\(0\.0, \(([^)]*)\)\), \(0\.55,/,
        replace: (tokens) =>
          hexTriple(value(tokens, '--color-brand-gradient-from', 'STROKE_GRADIENT')),
      },
      {
        anchor: /\(0\.55, \(([^)]*)\)\)/,
        replace: (tokens) =>
          hexTriple(value(tokens, '--color-brand-gradient-mid', 'STROKE_GRADIENT')),
      },
      {
        anchor: /\(0\.55, \([^)]*\)\), \(1\.0, \(([^)]*)\)\)/,
        replace: (tokens) =>
          hexTriple(value(tokens, '--color-brand-gradient-to', 'STROKE_GRADIENT')),
      },
      {
        anchor: /SPARK_GRADIENT = \([\s\S]*?\(\(0\.0, \(([^)]*)\)\)/,
        replace: (tokens) => hexTriple(value(tokens, '--color-brand-spark-from', 'SPARK_GRADIENT')),
      },
      {
        anchor: /SPARK_GRADIENT = \([\s\S]*?\(1\.0, \(([^)]*)\)\)/,
        replace: (tokens) => hexTriple(value(tokens, '--color-brand-spark-to', 'SPARK_GRADIENT')),
      },
    ],
  },
  {
    file: 'web/public/favicon.svg',
    sites: [
      {
        anchor: /<rect[^>]*fill="([^"]*)"/,
        replace: (tokens) => value(tokens, '--color-gray-900', 'favicon tile'),
      },
      {
        anchor: /id="mark"[\s\S]*?<stop stop-color="([^"]*)"/,
        replace: (tokens) => value(tokens, '--color-brand-gradient-from', 'mark gradient'),
      },
      {
        anchor: /id="mark"[\s\S]*?offset="0\.55" stop-color="([^"]*)"/,
        replace: (tokens) => value(tokens, '--color-brand-gradient-mid', 'mark gradient'),
      },
      {
        anchor: /id="mark"[\s\S]*?offset="1" stop-color="([^"]*)"/,
        replace: (tokens) => value(tokens, '--color-brand-gradient-to', 'mark gradient'),
      },
      {
        anchor: /id="spark"[\s\S]*?<stop stop-color="([^"]*)"/,
        replace: (tokens) => value(tokens, '--color-brand-spark-from', 'spark gradient'),
      },
      {
        anchor: /id="spark"[\s\S]*?offset="1" stop-color="([^"]*)"/,
        replace: (tokens) => value(tokens, '--color-brand-spark-to', 'spark gradient'),
      },
    ],
  },
  {
    // Two sites, not one: the frame paints before the shell loads, and the
    // page shown when the server does not come up paints without it entirely.
    file: 'desktop/main.js',
    sites: [
      {
        anchor: /backgroundColor: '([^']*)'/,
        replace: (tokens) => value(tokens, '--color-navigation', 'window background'),
      },
      {
        anchor: /<body style="[^"]*background:([^;"]*)/,
        replace: (tokens) => value(tokens, '--color-navigation', 'fallback page background'),
      },
      {
        anchor: /<body style="[^"]*color:([^;"]*)/,
        replace: (tokens) => value(tokens, '--color-text', 'fallback page text'),
      },
    ],
  },
  {
    // The document states the palette, and which part of it to state is an
    // editorial choice: the key list stays where a reader can see it and only
    // the values are generated. A key with no token is a loud failure.
    file: 'DESIGN.md',
    sites: [
      {
        anchor: /^colors:\n((?: {2}\S[^\n]*\n)+)/m,
        replace: (tokens, source) => {
          const block = /^colors:\n((?: {2}\S[^\n]*\n)+)/m.exec(source)[1]
          return block.replaceAll(/^ {2}([a-z][\w-]*): "[^"]*"$/gm, (_, name) => {
            // The block heading is the namespace: a key under `colors:` names a
            // `--color-*` token, so the document does not repeat the dimension.
            const token = `--color-${name}`
            const where = `DESIGN.md ${name}`
            return `  ${name}: "${value(tokens, token, where)}"`
          })
        },
      },
      {
        // Regenerated whole rather than key by key: the ramp is the ramp, and
        // stating six of its eight steps is how `figure` went unstated.
        anchor: /^ {2}scale:\n((?: {4}\S[^\n]*\n)+)/m,
        replace: (tokens) =>
          rampSteps(tokens)
            .map(([name, token]) => `    ${name.replace('--font-size-', '')}: "${token.value}"\n`)
            .join(''),
      },
      {
        anchor: /^rounded:\n((?: {2}\S[^\n]*\n)+)/m,
        replace: (tokens) =>
          [
            ['control', '--radius-control'],
            ['panel', '--radius-card'],
            ['status', '--radius-status'],
            ['shell', '--radius-shell'],
          ]
            .map(([key, token]) => {
              const where = `rounded.${key}`
              return `  ${key}: "${value(tokens, token, where)}"\n`
            })
            .join(''),
      },
    ],
  },
]

/** One mirror, rewritten. Returns the new text, unchanged or not. */
function render(mirror, tokens) {
  let source = read(mirror.file)
  for (const site of mirror.sites) {
    const global = new RegExp(site.anchor.source, `${site.anchor.flags}g`)
    const hits = [...source.matchAll(global)]
    if (hits.length !== 1) {
      throw new Error(`${mirror.file}: ${site.anchor} matched ${hits.length} times, expected 1`)
    }
    const [match] = hits
    let replacement
    try {
      replacement = site.replace(tokens, source)
    } catch (error) {
      throw new Error(`${mirror.file}: ${error.message}`, { cause: error })
    }
    const start = match.index + match[0].indexOf(match[1])
    source = source.slice(0, start) + replacement + source.slice(start + match[1].length)
  }
  return source
}

export function syncTokens({ write }) {
  const tokens = readTokens()
  const drifted = []
  for (const mirror of MIRRORS) {
    const next = render(mirror, tokens)
    if (next === read(mirror.file)) continue
    drifted.push(mirror.file)
    if (write) writeFileSync(fileURLToPath(new URL(mirror.file, repoRoot)), next, 'utf8')
  }
  return drifted
}

function run() {
  const check = process.argv.includes('--check')
  let drifted
  try {
    drifted = syncTokens({ write: !check })
  } catch (error) {
    // A structural failure means a mirror moved out from under its anchor, and
    // the useful half of that is the sentence, not the stack.
    console.error(`tokens: ${error.message}`)
    process.exitCode = 1
    return
  }
  if (!drifted.length) {
    console.log(`tokens in sync across ${MIRRORS.length} mirrors`)
    return
  }
  if (check) {
    console.error(
      `these mirrors no longer match tokens.css:\n  ${drifted.join('\n  ')}\nrun: npm run tokens:sync`,
    )
    process.exitCode = 1
    return
  }
  console.log(`rewrote:\n  ${drifted.join('\n  ')}`)
}

const entry = process.argv[1] ? pathToFileURL(resolvePath(process.argv[1])).href : ''
if (entry === import.meta.url) run()
