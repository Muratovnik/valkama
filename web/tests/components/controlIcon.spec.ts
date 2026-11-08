/**
 * The places a session or a file opens in, as a choice shows them: each kind of place
 * draws a glyph of its own, so an editor, an agent's app and a terminal are told apart
 * before their names are read. An editor and Claude Desktop once both drew a monitor.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ControlIconName } from '@/shared/ui/choiceControls.ts'
import ControlIcon from '@/shared/ui/ControlIcon.vue'
import { placeIcon } from '@/shared/ui/placeIcon.ts'

const drawn = (name: ControlIconName) => mount(ControlIcon, { props: { name } }).html()

describe('the glyph of a place to open in', () => {
  const places: ControlIconName[] = [
    'vscode',
    'cursor',
    'claude',
    'codex',
    'terminal',
    'last-place',
    'command',
  ]

  it.each(places.flatMap((one, at) => places.slice(at + 1).map((other) => [one, other])))(
    '%s and %s draw different glyphs',
    (one, other) => {
      expect(drawn(one as ControlIconName)).not.toBe(drawn(other as ControlIconName))
    },
  )
})

// A product's mark stands for that product only. Windsurf, JetBrains and an unnamed IDE drew
// VS Code's glyph while it was a neutral editor; with a mark there, they would have drawn a
// logo that is not theirs.
describe('a place with no mark of its own', () => {
  const marked = ['vscode', 'cursor', 'claude-desktop', 'codex-app'] as const

  it.each(['windsurf', 'jetbrains', 'ide'])('%s draws the neutral editor', (place) => {
    const glyph = placeIcon(place)
    expect(glyph).toBe('editor')
    for (const product of marked) expect(glyph).not.toBe(placeIcon(product))
  })
})
