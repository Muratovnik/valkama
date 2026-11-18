import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { h } from 'vue'

import { test } from 'vitest'
import { renderToString } from 'vue/server-renderer'

import BrandMark from '@/shared/ui/BrandMark.vue'

import { uncommented } from '../scripts/ui-system/comments.mjs'

/**
 * One mark, five renderers.
 *
 * The application imports `BrandMark.vue`. A browser tab cannot, so
 * `public/favicon.svg` repeats the drawing; a Windows ICO cannot either, so
 * `windows/make_icon.py` repeats it again as polygons. The shell's skeleton, which
 * the desktop window (`desktop/startup_page.js`) and `index.html` draw before the
 * application exists, repeats the rail's one-ink mark. Copies that nothing compares are
 * copies that drift, and this one drifts in public: the tab, the tray and the
 * installer are what a person sees before the application opens.
 *
 * The colors are not compared here. `scripts/sync-tokens.mjs` writes the body
 * and accent colours into the tab and the ICO and `npm run check:tokens` fails
 * when one of them moves, so palette equality is produced rather than asserted.
 * What a generator cannot produce is the drawing: the path data, the two tones
 * the component switches between, and where the mark sits on the grid.
 */
const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const component = read('../src/shared/ui/BrandMark.vue')
const favicon = read('../public/favicon.svg')
const iconScript = read('../../windows/make_icon.py')
const index = read('../index.html')
const startupSource = read('../../desktop/startup_page.js')
const startupPage = (
  createRequire(import.meta.url)('../../desktop/startup_page.js') as {
    renderStartupPage: (state: Record<string, unknown>) => string
  }
).renderStartupPage({ phase: 'starting', locale: 'en' })

/** The two fills, as they appear in the drawing's own 96-unit space. */
const BODY = 'M48 94L59 72L24 2H2L48 94Z'
const ACCENT =
  'M62.91 64.17L73 44H52.83L62.91 64.17ZM75 0L79.65 13.35L90.5 18L79.65 22.65L75 36L70.35 22.65L59.5 18L70.35 13.35L75 0Z'

type Point = [number, number]

/**
 * A straight-line path as its closed subpaths' corner points.
 *
 * Only M, L, H, V and Z, absolute, because that is all the drawing is. The
 * closing point that repeats the start is dropped, since a polygon closes
 * itself; an unexpected command fails rather than being skipped.
 */
function polygons(path: string): Point[][] {
  const shapes: Point[][] = []
  let current: Point[] = []
  let at: Point = [0, 0]
  for (const [, command, args] of path.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const numbers = args.trim()
      ? args
          .trim()
          .split(/[\s,]+/)
          .map(Number)
      : []
    switch (command) {
      case 'M': {
        current = []
        shapes.push(current)
        at = [numbers[0], numbers[1]]
        break
      }
      case 'L': {
        at = [numbers[0], numbers[1]]
        break
      }
      case 'H': {
        at = [numbers[0], at[1]]
        break
      }
      case 'V': {
        at = [at[0], numbers[0]]
        break
      }
      case 'Z': {
        const [first] = current
        const last = current.at(-1)
        if (last && first && last[0] === first[0] && last[1] === first[1]) current.pop()
        continue
      }
      default: {
        throw new Error(`the mark is straight lines only, and ${command} is not one`)
      }
    }
    current.push(at)
  }
  return shapes
}

/** A Python list of point tuples, `[[(48.0, 94.0), …], …]`, from make_icon.py. */
function scriptPolygons(name: string): Point[][] {
  const literal = new RegExp(`^${name} = \\[\\n([\\s\\S]*?)^\\]`, 'm').exec(iconScript)
  assert.ok(literal, `make_icon.py no longer declares ${name}`)
  return [...literal[1].matchAll(/\[([^\]]*)\]/g)].map(([, body]) =>
    [...body.matchAll(/\((-?[\d.]+), (-?[\d.]+)\)/g)].map(
      ([, x, y]) => [Number(x), Number(y)] as Point,
    ),
  )
}

test('the tab shows the same drawing the application does', () => {
  for (const path of [BODY, ACCENT]) {
    assert.ok(component.includes(`d="${path}"`), `BrandMark.vue lost a path: ${path.slice(0, 24)}…`)
    assert.ok(favicon.includes(`d="${path}"`), `favicon.svg lost a path: ${path.slice(0, 24)}…`)
    for (const [name, page] of [
      ['startup_page.js', startupPage],
      ['index.html', index],
    ] as const) {
      assert.ok(page.includes(`d="${path}"`), `${name} lost a path: ${path.slice(0, 24)}…`)
    }
  }
  assert.match(component, /viewBox="0 0 96 96"/)
})

test('the Windows icon draws the same polygons as the paths', () => {
  assert.deepEqual(scriptPolygons('BODY_POLYGONS'), polygons(BODY))
  assert.deepEqual(scriptPolygons('ACCENT_POLYGONS'), polygons(ACCENT))
})

/** Each path the component renders with these props, by its drawing, and the fill it gets. */
async function fills(props: Record<string, unknown>) {
  const html = await renderToString(h(BrandMark, props))
  return Object.fromEntries(
    [...html.matchAll(/<path\b[^>]*>/g)].map(([path]) => [
      /\sd="([^"]*)"/.exec(path)?.[1],
      /\sfill="([^"]*)"/.exec(path)?.[1],
    ]),
  )
}

test('inside the shell the mark is one ink, and alone it is two flat colours', async () => {
  // A second colour in the chrome is a chromatic event in a chrome that rations
  // a status to one dot. Alone on its tile the mark is the stroke and the
  // accent, each one flat colour from the palette.
  assert.deepEqual(await fills({ tone: 'chrome' }), {
    [BODY]: 'currentColor',
    [ACCENT]: 'currentColor',
  })
  const brand = { [BODY]: 'var(--color-brand-body)', [ACCENT]: 'var(--color-brand-accent)' }
  assert.deepEqual(await fills({ tone: 'brand' }), brand)
  assert.deepEqual(await fills({}), brand, 'alone is the default')
  const nav = read('../src/widgets/app-nav/components/AppNav.vue')
  assert.match(uncommented('AppNav.vue', nav), /<BrandMark\b[^>]*\stone="chrome"/)
  // The skeleton draws the rail's mark, so in the rail's ink: the paths carry no fill
  // of their own and the mark fills with the colour of the rail's header.
  for (const [name, page] of [
    ['startup_page.js', startupPage],
    ['index.html', index],
  ] as const) {
    assert.match(page, /\.sk-mark \{[^}]*fill: currentColor;/, `${name} fills the mark another way`)
    assert.doesNotMatch(page, /<path\s+d="[^"]*"\s+fill=/, `${name} gives a path its own fill`)
  }
})

test('no renderer of the mark draws a gradient any more', () => {
  for (const [name, source] of [
    ['BrandMark.vue', component],
    ['favicon.svg', favicon],
    ['make_icon.py', iconScript],
    ['startup_page.js', startupSource],
    ['index.html', index],
  ] as const) {
    assert.doesNotMatch(source, /gradient/i, `${name} still draws a gradient`)
  }
})

test('the mark sits at the same place on the same grid in both raster paths', () => {
  const offset = /MARK_OFFSET = \((\d+(?:\.\d+)?), (\d+(?:\.\d+)?)\)/.exec(iconScript)
  const scale = /MARK_SCALE = (\d+(?:\.\d+)?)/.exec(iconScript)
  assert.ok(offset && scale, 'make_icon.py no longer states where the mark sits')
  assert.ok(
    favicon.includes(
      `translate(${Number(offset[1])} ${Number(offset[2])}) scale(${Number(scale[1])})`,
    ),
    'favicon.svg and make_icon.py place the mark differently',
  )
  const corner = /^CORNER = (\d+)/m.exec(iconScript)
  assert.ok(corner, 'make_icon.py no longer states the tile corner')
  assert.ok(favicon.includes(`rx="${corner[1]}"`), 'the tab and the ICO round the tile differently')
})
