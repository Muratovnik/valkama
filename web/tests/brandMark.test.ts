import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

/**
 * One mark, three renderers.
 *
 * The application imports `BrandMark.vue`. A browser tab cannot, so
 * `public/favicon.svg` repeats the drawing; a Windows ICO cannot either, so
 * `windows/make_icon.py` repeats it again as polygons. Copies that nothing compares are
 * copies that drift, and this one drifts in public: the tab, the tray and the
 * installer are what a person sees before the application opens.
 *
 * The colors are no longer compared here. `scripts/sync-tokens.mjs` writes the
 * gradient stops into all three renderers and `npm run check:tokens` fails when
 * one of them moves, so palette equality is produced rather than asserted. What
 * a generator cannot produce is the drawing: the path data, the two tones the
 * component switches between, and where the mark sits on the grid.
 */
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const component = read('../src/shared/ui/BrandMark.vue')
const favicon = read('../public/favicon.svg')
const iconScript = read('../../windows/make_icon.py')

/** The three filled shapes, as they appear in the drawing's own space. */
const PATHS = [
  'M0 0H88L230 239L190 306L0 0Z',
  'M210 175L240 225L339 67L284 67L210 175Z',
  'M338.5 21C340 29.5 344 33.5 353 35C344 36.5 340 40.5 338.5 49C337 40.5 333 36.5 324 35C333 33.5 337 29.5 338.5 21Z',
]

test('the tab shows the same drawing the application does', () => {
  for (const path of PATHS) {
    assert.ok(component.includes(path), `BrandMark.vue lost a path: ${path.slice(0, 24)}…`)
    assert.ok(favicon.includes(path), `favicon.svg lost a path: ${path.slice(0, 24)}…`)
  }
})

test('inside the shell the mark is one ink, and the gradient stays on OS surfaces', () => {
  // The gradient is the only one in an interface that forbids gradients, and it
  // spends four chromatic events in a chrome that rations a status to one dot.
  // It keeps the tab, the tray and the installer, where the mark stands alone
  // on a ground this palette does not own.
  assert.match(component, /tone\?:\s*'brand'\s*\|\s*'chrome'/)
  assert.match(component, /tone === 'chrome' \? 'currentColor'/)
  assert.match(component, /<defs v-if="tone === 'brand'">/)
  const nav = read('../src/widgets/app-nav/components/AppNav.vue')
  assert.match(nav, /<BrandMark[^>]*tone="chrome"/)
})

test('the component reads the brand ramp instead of drawing its own', () => {
  // The generator writes the literal stops into the tab and the ICO, but it
  // cannot write this one: the component resolves the tokens through the
  // cascade, so what it needs is the reference, not the value.
  for (const name of [
    '--color-brand-gradient-from',
    '--color-brand-gradient-mid',
    '--color-brand-gradient-to',
    '--color-brand-spark-from',
    '--color-brand-spark-to',
  ]) {
    assert.ok(component.includes(`var(${name})`), `BrandMark.vue no longer reads ${name}`)
  }
})

test('the mark sits at the same place on the same grid in both raster paths', () => {
  const offset = /MARK_OFFSET = \((\d+(?:\.\d+)?), (\d+(?:\.\d+)?)\)/.exec(iconScript)
  const scale = /MARK_SCALE = (\d+\.\d+)/.exec(iconScript)
  assert.ok(offset && scale, 'make_icon.py no longer states where the mark sits')
  assert.ok(
    favicon.includes(`translate(${Number(offset[1])} ${Number(offset[2])}) scale(${scale[1]})`),
    'favicon.svg and make_icon.py place the mark differently',
  )
})
