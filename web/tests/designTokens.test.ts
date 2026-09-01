import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import { CHART_FONT_FAMILY } from '@/widgets/analytics-dashboard/utils/chartOptions.ts'

// @ts-expect-error - the generator is a plain script, and the tokens it reads
// are the same ones this file asserts relationships about.
import { readTokens } from '../scripts/sync-tokens.mjs'

/**
 * The palette's relationships, which no generator can check.
 *
 * Equality between `tokens.css` and its seven mirrors used to be asserted here,
 * file by file. `scripts/sync-tokens.mjs` writes those mirrors now, so equality
 * is not a property to test but a thing the build produces, and `npm run
 * check:tokens` fails the gate when one drifts. One invariant, one owner.
 *
 * What is left is what a copy can be perfectly faithful to and still get wrong:
 * whether the two zones are far enough apart to be two zones, whether the
 * direction runs the way the reference runs it, and whether a sheet still sits
 * above the ground it lies on. Those are facts about the palette rather than
 * about its copies.
 */
const tokens = readTokens() as Map<string, { declared: string; value: string }>

/** A token's resolved value: the semantic tier spells `var()`, and this follows it. */
function token(name: string): string {
  const found = tokens.get(name)
  assert.ok(found, `${name} is missing from tokens.css`)
  return found.value
}

const channel = (hex: string, index: number) =>
  Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)

const luminance = (hex: string) =>
  0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)

/** How far apart the coldest and warmest channel are: 0 is grey, 10 is a cast. */
const spread = (hex: string) =>
  Math.max(channel(hex, 0), channel(hex, 1), channel(hex, 2)) -
  Math.min(channel(hex, 0), channel(hex, 1), channel(hex, 2))

/**
 * Whether a chrome and a workspace read as two zones.
 *
 * Two ways to pass, because there are two ways to be right. A neutral chrome
 * has to be much darker to separate — the eye has only lightness to go on — so
 * it owes 1.6. A tinted one carries a second signal and can sit closer, at
 * 1.35, but its cast has to be a temperature rather than a color: below 6 there
 * is nothing to see, and above 14 the shell is painted rather than lit.
 *
 * The workspace is neutral in both branches. That is not symmetry for its own
 * sake: a cast on the panel is a cast on every surface in the product, which is
 * the violet failure, and it is the contrast between a tinted backing and a
 * neutral panel that says which of the two is the backing.
 */
/** How far one ladder role stands above another, in the first channel. */
const step = (lower: string, upper: string) => channel(token(upper), 0) - channel(token(lower), 0)

function zonesRead(nav: string, canvas: string): boolean {
  if (spread(canvas) > 2) return false
  const ratio = luminance(canvas) / luminance(nav)
  const tinted = spread(nav) >= 6 && spread(nav) <= 14
  return tinted ? ratio >= 1.35 : spread(nav) <= 2 && ratio >= 1.6
}

test('chrome and workspace are two zones, not two blacks', () => {
  assert.ok(
    zonesRead(token('--color-navigation'), token('--color-canvas')),
    'the workspace no longer reads as a panel lying on the chrome',
  )
})

test('the zone oracle still rejects every pairing this palette has shipped wrong', () => {
  // A floor is only a floor if it fails something. This one has been wrong
  // before: at 1.2 it passed both of the merged pairings below — 1.38 and
  // 1.33 — and so certified the very defect it was written for. The tinted
  // branch is new and had to be added without reopening any of these.
  assert.equal(zonesRead('#0d0d0d', '#121212'), false, 'a difference no eye can see')
  assert.equal(zonesRead('#181818', '#121212'), false, 'the direction inverted')
  assert.equal(zonesRead('#1a1625', '#241f33'), false, 'a violet cast on the panel too')
  assert.equal(zonesRead('#0d1117', '#1b1a22'), false, 'a cast that leaked onto the workspace')
  // Too little tint to see, and too much to be a temperature. Neither is a
  // near miss the eye would forgive.
  assert.equal(zonesRead('#0d0e10', '#181818'), false, 'a cast below the threshold of sight')
  assert.equal(zonesRead('#080f22', '#181818'), false, 'a chrome painted rather than lit')
  // And the two that must stay open: today's tinted chrome, and the neutral
  // one it can be flipped back to by pointing three tokens at the gray ramp.
  assert.equal(zonesRead('#0d1117', '#181818'), true, 'the tinted chrome')
  assert.equal(zonesRead('#0d0d0d', '#181818'), true, 'the neutral chrome')
})

test('the chrome is tinted as one family, not one step at a time', () => {
  // Three tokens paint the rail: its ground, its hover and its pressed state.
  // A tint applied to the ground alone would put a neutral hover on a cold
  // ground, which is the seam the one-ground rule already exists to prevent,
  // one state deeper.
  const chrome = [
    '--color-navigation',
    '--color-navigation-raised',
    '--color-navigation-active',
  ].map((name) => token(name))
  const casts = chrome.map((value) => spread(value))
  const tinted = casts.filter((cast) => cast >= 6).length
  assert.ok(
    tinted === 0 || tinted === chrome.length,
    `the chrome is half-tinted: casts ${casts.join(', ')}`,
  )
  // And the states stay a ladder: each step is visibly above the one below.
  const steps = chrome.map((value) => luminance(value))
  for (let index = 1; index < steps.length; index += 1) {
    assert.ok(
      steps[index] - steps[index - 1] >= 5,
      `chrome step ${index} is ${(steps[index] - steps[index - 1]).toFixed(1)} from the one below`,
    )
  }
})

test('the chrome is one ground, so the rail and the context bar cannot drift', () => {
  const shell = readFileSync(
    fileURLToPath(new URL('../src/app/styles/shell.css', import.meta.url)),
    'utf8',
  )
  const app = readFileSync(fileURLToPath(new URL('../src/app/App.vue', import.meta.url)), 'utf8')
  // The bar is its own component, so its ground is asserted where it is set.
  const bar = readFileSync(
    fileURLToPath(new URL('../src/app/components/AppContextBar.vue', import.meta.url)),
    'utf8',
  )
  // The rail paints itself now, so its ground is asserted where it is set.
  const rail = readFileSync(
    fileURLToPath(new URL('../src/widgets/app-nav/components/AppNav.vue', import.meta.url)),
    'utf8',
  )
  // The rail and the context bar are one surface with a corner in it. They were
  // painted from two different tokens, so the corner had a seam in it and the
  // header read as a third zone. Whatever `--color-navigation` becomes, both take it.
  const backgroundOf = (source: string, selector: string) => {
    const block = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(source)
    assert.ok(block, `${selector} no longer declares a block`)
    return /background:\s*([^;]+);/.exec(block[1])?.[1].trim()
  }
  assert.equal(backgroundOf(shell, 'app-shell'), 'var(--color-navigation)')
  assert.equal(backgroundOf(rail, 'app-nav-shell'), 'var(--color-navigation)')
  assert.equal(backgroundOf(bar, 'context-bar'), 'var(--color-navigation)')
  // And the workspace is the one element that breaks out of it, at one corner.
  const stage = /\.module-stage\s*\{([^}]*)\}/.exec(app)
  assert.ok(stage, 'the workspace panel no longer declares a block')
  assert.match(stage[1], /background:\s*var\(--color-canvas\);/)
  assert.match(stage[1], /border-top-left-radius:\s*var\(--radius-shell\);/)
})

test('a sheet sits a step above the ground it lies on', () => {
  // A card lies on a lane, a lane on the canvas. When the sheet and the surface
  // under it were the same value, a column of cards had no column to be part
  // of: the board read as one dark mass with text floating in it.
  assert.ok(step('--color-canvas', '--color-surface') >= 4, 'the ground lost its step')
  assert.ok(step('--color-surface', '--color-surface-sheet') >= 4, 'the sheet lost its step')
})

test('two ladder roles never land on one tone', () => {
  // What a role earns is a place to stand, so two roles resolving to the same
  // value are one role wearing two names. `--surface-panel` and
  // `--color-surface-sheet` were that pair: DESIGN.md described four steps while the
  // palette shipped a panel and a sheet painted identically, and nothing could
  // tell whether a rule meant the tone or the position.
  const roles = ['--color-surface-sheet', '--color-surface-recess']
  const tones = roles.map((role) => token(role).toLowerCase())
  assert.equal(new Set(tones).size, roles.length, `ladder roles collide: ${tones.join(' ')}`)
})

test('a control fill stands above every static ground, and its states run upward', () => {
  // Controls are fills, not outlines, so the fill is the whole affordance.
  // The resting fill sat level with the muted ground once; nobody saw it while
  // every control also wore a border, and removing the borders left a filled
  // button standing on a sheet invisible at rest.
  for (const ground of ['--color-canvas', '--color-surface', '--color-surface-muted']) {
    assert.ok(
      step(ground, '--color-control-surface') >= 4,
      `a resting control melts into ${ground}`,
    )
  }
  assert.ok(step('--color-control-surface', '--color-surface-active') >= 4, 'hover lost its lift')
  assert.ok(
    step('--color-control-disabled-surface', '--color-control-surface') >= 4,
    'disabled must recede',
  )
})

test('a modal scrim puts the window behind it out of reach', () => {
  // It was `rgb(21 24 27 / 42%)`, written into one component where no guard
  // could see it — the hex rule reads `#`, and this is `rgb()`. Over the canvas
  // it darkened by about one step of the grey ramp, which is the distance
  // between two ordinary surfaces, so a dialog read as one more panel.
  const scrim = token('--color-overlay-scrim')
  const alpha = /\/\s*(\d+)%/.exec(scrim)
  assert.ok(alpha, `--color-overlay-scrim carries no percentage: ${scrim}`)
  assert.ok(
    Number(alpha[1]) >= 60,
    `a scrim at ${alpha[1]}% leaves the window behind it looking reachable`,
  )
  // Dimming, not tinting: the scrim is darker than the darkest ground in the
  // product, so every surface under it moves the same way.
  const channels = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/.exec(scrim)
  assert.ok(channels, `--color-overlay-scrim is not a plain rgb triple: ${scrim}`)
  assert.ok(
    luminance(token('--color-navigation')) >
      luminance(
        `#${channels
          .slice(1, 4)
          .map((c) => Number(c).toString(16).padStart(2, '0'))
          .join('')}`,
      ),
    'the scrim is lighter than the chrome, so it lifts what it covers instead of dimming it',
  )
})

test('the control tier keeps the drawing and the pointer target apart', () => {
  // One token answered both questions — `--size-control-target`, the 44px
  // accessibility target — so every control was drawn at the size of its own
  // hit area, and a track that wrapped one came out 48px beside a 44px button.
  // Two names, and the drawing is the smaller of the two by construction.
  const px = (name: string) => {
    const raw = token(name)
    assert.match(raw, /^\d+px$/, `${name} is not a plain pixel size`)
    return Number.parseInt(raw, 10)
  }
  const row = px('--size-control-height')
  const compact = px('--size-control-height-compact')
  const target = px('--size-control-target')
  assert.ok(row < target, 'the row and the pointer target have collapsed into one number again')
  assert.ok(target >= 44, `a pointer target of ${target}px is below the 44px this product keeps`)
  assert.ok(compact < row, 'the compact size is not smaller than the row it densifies')
  for (const [name, size] of [
    ['--size-control-height', row],
    ['--size-control-height-compact', compact],
  ] as const) {
    assert.equal(size % 4, 0, `${name} is ${size}px, off the four-pixel grid`)
  }
  // A track subtracts its own inset from the row, so the segments inside it
  // have to fit: two insets and a line of 14px text at the tight leading.
  assert.ok(row - 2 * 2 >= 32, 'a segment derived from the row no longer has room for its text')
})

test('the semantic tier resolves through the palette instead of spelling a value', () => {
  // The tier split is what lets the chrome move without dragging the canvas,
  // and it holds only while the zones name a ramp step rather than repeat one.
  // Both of these were `#181818` written twice before the ramp existed.
  for (const name of [
    '--color-navigation',
    '--color-navigation-raised',
    '--color-canvas',
    '--color-surface',
    '--color-accent',
    '--color-action-danger',
    '--color-danger',
    '--color-success',
    '--color-warning',
  ]) {
    assert.match(
      tokens.get(name)?.declared ?? '',
      /^var\(--[a-z][\w-]*\)$/,
      `${name} spells a value instead of naming a primitive`,
    )
  }
})

test('destructive actions use an action role instead of an operational status role', () => {
  const button = readFileSync(
    fileURLToPath(new URL('../src/shared/ui/VButton.vue', import.meta.url)),
    'utf8',
  )
  const dangerVariant = /&\.variant-danger\s*\{([^}]*)\}/.exec(button)
  assert.ok(dangerVariant, 'VButton no longer declares its destructive action variant')
  assert.match(dangerVariant[1], /color:\s*var\(--color-action-danger\);/)
  assert.doesNotMatch(dangerVariant[1], /var\(--color-danger\)/)
})

test('a chart names a family canvas can actually read', () => {
  // Equality with `--font-family-interface` belongs to the generator. What stays here is
  // the reason the mirror exists at all: `var(--font-family-interface)` reached this
  // constant for a long time and never resolved, because canvas has no cascade.
  assert.ok(!CHART_FONT_FAMILY.includes('var('))
})
