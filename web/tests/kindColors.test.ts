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

import { scanUiSources } from '../scripts/ui-system/styles.mjs'
import type { Vision } from './paletteColors.ts'
import { apart, contrast, linear, token, VISION } from './paletteColors.ts'

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
    for (const vision of Object.keys(VISION) as Vision[])
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
