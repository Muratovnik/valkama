import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

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
 * whether the two zones are far enough apart to be two zones, whether a card
 * still reads on its lane and a lane on the panel, and whether the text and
 * the colours that carry meaning still read on every ground they stand on.
 * Those are facts about the palette rather than about its copies.
 */
const tokens = readTokens() as Map<string, { declared: string; value: string }>

/** A token's resolved value: the semantic tier spells `var()`, and this follows it. */
function token(name: string): string {
  const found = tokens.get(name)
  assert.ok(found, `${name} is missing from tokens.css`)
  return found.value
}

/** `#333` is `#333333`: stylelint asks for the short form wherever one exists. */
const longHex = (hex: string) => (hex.length === 4 ? hex.replaceAll(/[0-9a-f]/giu, '$&$&') : hex)

const channel = (hex: string, index: number) =>
  Number.parseInt(longHex(hex).slice(1 + index * 2, 3 + index * 2), 16)

const luminance = (hex: string) =>
  0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2)

/** How far apart the coldest and warmest channel are: 0 is grey, 10 is a cast. */
const spread = (hex: string) =>
  Math.max(channel(hex, 0), channel(hex, 1), channel(hex, 2)) -
  Math.min(channel(hex, 0), channel(hex, 1), channel(hex, 2))

/** WCAG 2 relative luminance: the measure a contrast ratio is taken in. */
function relativeLuminance(hex: string): number {
  const linear = (index: number) => {
    const unit = channel(hex, index) / 255
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(0) + 0.7152 * linear(1) + 0.0722 * linear(2)
}

/**
 * The WCAG 2 contrast ratio of two colours, lighter over darker.
 *
 * The `+ 0.05` in it is a model of the glare on a real screen, and it is why
 * this is the measure for the surface ladder rather than a channel difference:
 * at the dark end of the ramp a step of eight hex units is a large ratio of two
 * tiny luminances, which a good panel in a dark room shows and an office
 * monitor in daylight does not. The ladder that blended was eight units a step.
 */
function contrast(first: string, second: string): number {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  )
  return (light + 0.05) / (dark + 0.05)
}

/** The contrast of two tokens, by name. */
const between = (upper: string, lower: string) => contrast(token(upper), token(lower))

const lighter = (upper: string, lower: string) =>
  relativeLuminance(upper) > relativeLuminance(lower)

/** One token stands visibly above another: lighter, and by a ratio a control can be told by. */
const above = (upper: string, lower: string) =>
  lighter(token(upper), token(lower)) && between(upper, lower) >= 1.1

/**
 * Whether a lane reads on the panel and a card on its lane, with no line drawn.
 *
 * 1.20 is the smallest seam the interface showed as two surfaces before this
 * oracle existed — the settings band on the panel — and 1.10 is the one that
 * blended on the board. A lane is a large area and is held to a little less
 * than a card, which is the object a reader is looking for.
 */
function seamsRead(panel: string, ground: string, sheet: string): boolean {
  return (
    lighter(ground, panel) &&
    lighter(sheet, ground) &&
    contrast(ground, panel) >= 1.15 &&
    contrast(sheet, ground) >= 1.2
  )
}

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

test('a card reads on its lane and a lane on the panel, without a line', () => {
  // A card lies on a lane, a lane on the canvas. When the sheet and the surface
  // under it were the same value, a column of cards had no column to be part
  // of. Then they were a step apart in hex — #181818, #212121, #282828 — and
  // the old oracle, a channel difference of four, passed it while the owner
  // reported that everything blended: 1.10 and 1.09 in the measure below.
  const [panel, ground, sheet] = ['--color-canvas', '--color-surface', '--color-surface-sheet'].map(
    (name) => token(name),
  )
  assert.ok(
    seamsRead(panel, ground, sheet),
    `the workspace ladder blends: lane on panel ${contrast(ground, panel).toFixed(2)}, card on lane ${contrast(sheet, ground).toFixed(2)}`,
  )
})

test('the seam oracle rejects the ladder that blended, and the inverted one', () => {
  assert.equal(seamsRead('#181818', '#212121', '#282828'), false, 'the ladder the owner saw blend')
  assert.equal(seamsRead('#181818', '#333333', '#252525'), false, 'a card darker than its lane')
  assert.equal(seamsRead('#181818', '#252525', '#333333'), true, 'the ladder that replaced it')
})

test('secondary text holds 4.5:1 on every ground it is drawn on', () => {
  // Lifting the grounds lifts the text: the tertiary tone stood at 4.08:1 on
  // a hovered card before the ladder moved, under the AA floor already, and
  // a lighter card would have taken it further down.
  for (const ground of [
    '--color-canvas',
    '--color-surface',
    '--color-surface-sheet',
    '--color-surface-hover',
  ]) {
    for (const ink of ['--color-text', '--color-text-muted', '--color-text-tertiary']) {
      assert.ok(
        between(ink, ground) >= 4.5,
        `${ink} on ${ground} is ${between(ink, ground).toFixed(2)}:1`,
      )
    }
  }
  // A control and its pressed state carry full and muted text, never tertiary.
  for (const ground of ['--color-control-surface', '--color-surface-active']) {
    for (const ink of ['--color-text', '--color-text-muted']) {
      assert.ok(
        between(ink, ground) >= 4.5,
        `${ink} on ${ground} is ${between(ink, ground).toFixed(2)}:1`,
      )
    }
  }
  // And the three tones stay three: rank inside a row is carried by them.
  assert.ok(between('--color-text', '--color-text-muted') >= 1.4, 'text and muted have merged')
  assert.ok(
    between('--color-text-muted', '--color-text-tertiary') >= 1.3,
    'muted and tertiary have merged',
  )
})

test('every colour that carries meaning reads as text on a card and as a mark on a control', () => {
  // WCAG 1.4.3 for a state written in its colour, 1.4.11 for a dot, a glyph or
  // an edge. The lightest ground a word in colour stands on is a hovered card;
  // the lightest a mark stands on is a pressed control.
  for (const tone of ['--color-info', '--color-success', '--color-warning', '--color-danger']) {
    for (const ground of [
      '--color-canvas',
      '--color-surface',
      '--color-surface-sheet',
      '--color-surface-hover',
    ]) {
      assert.ok(
        between(tone, ground) >= 4.5,
        `${tone} on ${ground} is ${between(tone, ground).toFixed(2)}:1`,
      )
    }
    assert.ok(
      between(tone, '--color-surface-active') >= 3,
      `${tone} as a mark on a pressed control is ${between(tone, '--color-surface-active').toFixed(2)}:1`,
    )
  }
  // The one meaning colour written as a label on a control: a danger action
  // keeps its red word when hovered, and the hover fill is the pressed rung.
  // It stood at 4.20:1 there when the ladder moved under it.
  assert.ok(
    between('--color-action-danger', '--color-surface-active') >= 4.5,
    `a hovered danger label is ${between('--color-action-danger', '--color-surface-active').toFixed(2)}:1`,
  )
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
  // A channel difference of four used to be the floor here, which is the
  // measure that passed the blended board; these are contrast ratios.
  for (const ground of ['--color-canvas', '--color-surface', '--color-surface-muted']) {
    assert.ok(above('--color-control-surface', ground), `a resting control melts into ${ground}`)
  }
  assert.ok(above('--color-surface-active', '--color-control-surface'), 'hover lost its lift')
  assert.ok(
    above('--color-control-surface', '--color-control-disabled-surface'),
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
  // The variant names its label colour as a value the state rules read.
  assert.match(dangerVariant[1], /--color-button-ink:\s*var\(--color-action-danger\);/)
  assert.doesNotMatch(dangerVariant[1], /var\(--color-danger\)/)
})
