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
    const numbers = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : []
    if (command === 'M') {
      current = []
      shapes.push(current)
      at = [numbers[0], numbers[1]]
    } else if (command === 'L') at = [numbers[0], numbers[1]]
    else if (command === 'H') at = [numbers[0], at[1]]
    else if (command === 'V') at = [at[0], numbers[0]]
    else if (command === 'Z') {
      const [first] = current
      const last = current.at(-1)
      if (last && first && last[0] === first[0] && last[1] === first[1]) current.pop()
      continue
    } else throw new Error(`the mark is straight lines only, and ${command} is not one`)
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
  }
  assert.match(component, /viewBox="0 0 96 96"/)
})

test('the Windows icon draws the same polygons as the paths', () => {
  assert.deepEqual(scriptPolygons('BODY_POLYGONS'), polygons(BODY))
  assert.deepEqual(scriptPolygons('ACCENT_POLYGONS'), polygons(ACCENT))
})

test('inside the shell the mark is one ink, and alone it is two flat colours', () => {
  // A second colour in the chrome is a chromatic event in a chrome that rations
  // a status to one dot. Alone on its tile the mark is the stroke and the
  // accent, each one flat colour from the palette.
  assert.match(component, /tone\?:\s*'brand'\s*\|\s*'chrome'/)
  assert.match(
    component,
    /bodyFill = computed\(\(\) =>\s*props\.tone === 'chrome' \? 'currentColor' : 'var\(--color-brand-body\)'/,
  )
  assert.match(
    component,
    /accentFill = computed\(\(\) =>\s*props\.tone === 'chrome' \? 'currentColor' : 'var\(--color-brand-accent\)'/,
  )
  assert.match(component, new RegExp(`d="${BODY}"\\s*:fill="bodyFill"`))
  assert.match(component, new RegExp(`d="${ACCENT.replaceAll('.', '\\.')}"\\s*:fill="accentFill"`))
  const nav = read('../src/widgets/app-nav/components/AppNav.vue')
  assert.match(nav, /<BrandMark[^>]*tone="chrome"/)
})

test('no renderer of the mark draws a gradient any more', () => {
  for (const [name, source] of [
    ['BrandMark.vue', component],
    ['favicon.svg', favicon],
    ['make_icon.py', iconScript],
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
