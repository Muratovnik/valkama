/**
 * The places a session or a file opens in, as a choice shows them: each kind of place
 * draws a glyph of its own, so an editor, an agent's app and a terminal are told apart
 * before their names are read. An editor and Claude Desktop once both drew a monitor.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ControlIconName } from '@/shared/ui/choiceControls.ts'
import ControlIcon from '@/shared/ui/ControlIcon.vue'

const drawn = (name: ControlIconName) => mount(ControlIcon, { props: { name } }).html()

describe('the glyph of a place to open in', () => {
  const places: ControlIconName[] = [
    'vscode',
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
