/**
 * The colours of the four work item kinds: what a stored value may be, what the
 * defaults are held to, and how an owner's choice reaches the document. The
 * thresholds are WCAG's; the colour-vision matrices are Machado, Oliveira and
 * Fernandes (2009) at full severity, the distance is OKLab's. Neither is the
 * product's own arithmetic, which knows only the one contrast its hint needs.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  applyKindColors,
  DEFAULT_KIND_COLORS,
  kindColor,
  readKindColors,
  readsPoorly,
} from '@/shared/lib/kindColors.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '@/shared/lib/settings.ts'

// @ts-expect-error - the generator is a plain script, and it is what reads the stylesheet.
import { readTokens } from '../scripts/sync-tokens.mjs'
import { scanUiSources } from '../scripts/ui-system/styles.mjs'

const tokens = readTokens() as Map<string, { declared: string; value: string }>
const token = (name: string) => {
  const found = tokens.get(name)
  assert.ok(found, `${name} is missing from tokens.css`)
  return found.value
}

const longHex = (hex: string) => (hex.length === 4 ? hex.replaceAll(/[0-9a-f]/giu, '$&$&') : hex)
const linear = (hex: string) =>
  [1, 3, 5].map((start) => {
    const unit = Number.parseInt(longHex(hex).slice(start, start + 2), 16) / 255
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

function luminance(hex: string) {
  const [red, green, blue] = linear(hex)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(first: string, second: string) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [
    number,
    number,
  ]
  return (high + 0.05) / (low + 0.05)
}

const VISION = {
  ordinary: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
} as const

/** A colour as one kind of vision takes it, in OKLab. */
function seen(hex: string, vision: keyof typeof VISION) {
  const [red, green, blue] = linear(hex)
  const [r, g, b] = VISION[vision].map((row) =>
    Math.min(1, Math.max(0, row[0] * red + row[1] * green + row[2] * blue)),
  ) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ] as const
}

const apart = (first: string, second: string, vision: keyof typeof VISION) => {
  const [a, b] = [seen(first, vision), seen(second, vision)]
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

const KINDS = ['bug', 'epic', 'improvement', 'task'] as const
const kindTokens = () => KINDS.map((kind) => token(`--color-kind-${kind}`))

describe('the stored choice', () => {
  test('mergeSettings keeps a #rrggbb and gives anything else back to the default', () => {
    const merged = mergeSettings({
      kindColors: {
        bug: '#123abc',
        epic: 'red',
        improvement: '#12345',
        task: 7,
        nonsense: '#000000',
      },
    })
    assert.deepEqual(merged.kindColors, { bug: '#123abc' })
    for (const value of ['#12345g', '#1234567', ' #123456', 'rgb(1,2,3)', null, ['#123456']])
      assert.deepEqual(mergeSettings({ kindColors: { epic: value } }).kindColors, {})
    assert.equal(kindColor(merged.kindColors, 'epic'), token('--color-kind-epic'))
    assert.equal(kindColor(merged.kindColors, 'bug'), '#123abc')
  })

  test('a colour keeps one spelling, so a stored one compares with what a picker reports', () => {
    assert.deepEqual(readKindColors({ task: '#ABCDEF' }), { task: '#abcdef' })
  })

  test('a shape from before this setting, or a broken one, reads as the defaults', () => {
    for (const raw of [{}, { editor: 'cursor' }, { kindColors: 'violet' }, { kindColors: [] }])
      assert.deepEqual(mergeSettings(raw).kindColors, {})
    // And what else that shape stored still reads.
    const former = mergeSettings({ editor: 'cursor', openers: { claude: { kind: 'terminal' } } })
    assert.equal(former.editor, 'cursor')
    assert.equal(former.sessions.claude.fallback, 'terminal')
    assert.deepEqual(DEFAULT_SETTINGS.kindColors, {})
  })
})

describe('the defaults', () => {
  test('the mirror the settings page reads is the stylesheet', () => {
    assert.deepEqual(
      KINDS.map((kind) => DEFAULT_KIND_COLORS[kind]),
      kindTokens(),
    )
  })

  test('each reads at 4.5:1 as a word and so 3:1 as a glyph on every ground a mark stands on', () => {
    for (const ground of [
      '--color-surface-recess',
      '--color-surface',
      '--color-surface-sheet',
      '--color-surface-hover',
      '--color-tooltip-surface',
    ])
      for (const kind of KINDS) {
        const ratio = contrast(token(`--color-kind-${kind}`), token(ground))
        assert.ok(ratio >= 4.5, `${kind} on ${ground} stands at ${ratio.toFixed(2)}:1`)
      }
  })

  test('the four stay apart from each other under each common colour-vision deficiency', () => {
    for (const vision of Object.keys(VISION) as (keyof typeof VISION)[])
      for (const [index, first] of kindTokens().entries())
        for (const second of kindTokens().slice(index + 1)) {
          const distance = apart(first, second, vision)
          assert.ok(distance >= 0.06, `${first} and ${second}: ${distance.toFixed(3)} (${vision})`)
        }
  })

  test('none is taken for the state or the ink it stands beside', () => {
    for (const other of [
      '--color-danger',
      '--color-success',
      '--color-info',
      '--color-warning',
      '--color-text-tertiary',
      '--color-text-muted',
    ])
      for (const kind of kindTokens()) {
        const distance = apart(kind, token(other), 'ordinary')
        assert.ok(distance >= 0.035, `${kind} and ${other}: ${distance.toFixed(3)}`)
      }
  })

  test('the epic is a purple: its blue leads, then its red, well above its green', () => {
    const [red, green, blue] = linear(token('--color-kind-epic'))
    assert.ok(blue > red && red > green * 1.5, 'an epic that does not read as purple')
  })
})

const scan = (css: string) =>
  scanUiSources([{ file: 'future/Tile.vue', source: `<style>${css}</style>` }]).join(',')

test('the guard refuses a kind colour on a surface and lets it draw a mark', () => {
  const refused = /never a surface/u
  assert.match(scan('.tile { background: var(--color-kind-ink); }'), refused)
  assert.match(scan('.tile { color: red; background-color: var(--color-kind-epic); }'), refused)
  assert.doesNotMatch(scan('.glyph { color: var(--color-kind-ink); }'), refused)
})

describe('the hint', () => {
  test('falls under 3:1 on the lightest ground a mark stands on, and every default clears it', () => {
    for (const kind of KINDS) assert.equal(readsPoorly(DEFAULT_KIND_COLORS[kind]), false, kind)
    // The canonical epic purple stands at 1.93:1 on that ground, black at 2.22:1.
    assert.equal(readsPoorly('#a335ee'), true)
    assert.equal(readsPoorly('#000000'), true)
    assert.equal(readsPoorly('#ffffff'), false)
    const ground = token('--color-tooltip-surface')
    // Either side of the line, as WCAG's formula puts it.
    assert.ok(contrast('#9a9a9a', ground) >= 3)
    assert.equal(readsPoorly('#9a9a9a'), false)
    assert.ok(contrast('#8f8f8f', ground) < 3)
    assert.equal(readsPoorly('#8f8f8f'), true)
  })
})

function fakeRoot() {
  const written = new Map<string, string>()
  const style = {
    setProperty: (name: string, value: string) => void written.set(name, value),
    removeProperty: (name: string) => {
      written.delete(name)
      return ''
    },
  }
  return { root: { style } as unknown as HTMLElement, written }
}

describe('applying the choice', () => {
  test('a chosen kind overrides its variable and the others keep the stylesheet', () => {
    const { root, written } = fakeRoot()
    applyKindColors({ epic: '#112233' }, root)
    assert.deepEqual([...written], [['--color-kind-epic', '#112233']])
  })

  test('a kind reset takes its override off the document, which is how the default returns', () => {
    const { root, written } = fakeRoot()
    applyKindColors({ epic: '#112233', bug: '#445566' }, root)
    applyKindColors({ bug: '#445566' }, root)
    assert.deepEqual([...written], [['--color-kind-bug', '#445566']])
    applyKindColors({}, root)
    assert.deepEqual([...written], [])
  })
})
