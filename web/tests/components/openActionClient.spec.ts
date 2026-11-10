/**
 * The executor's sign on the button that opens its session. A tile draws who works an item by
 * its client — Claude's sign, Codex's, any other client's — and the card drew the same
 * executor by the place its session opens in, VS Code's or a terminal's, so one person read
 * two signs for one executor. The button now draws the client's sign as the tile does, and the
 * place stays in what a press does: the hint, «Open in VS Code», and the button's name.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { holderGlyph } from '@/entities/work-item/utils/facetExecutor.ts'

import { messages } from '@/shared/i18n/index.ts'
import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

import { hintOf } from '../support/hint.ts'
import {
  answerPlans,
  executor,
  mountAction,
  NAME,
  plan,
  resetOutsideWorld,
  restoreOutsideWorld,
  terminal,
  vscode,
  windowSteps,
} from '../support/openActionHarness.ts'

beforeEach(resetOutsideWorld)
afterEach(restoreOutsideWorld)

/** The drawing of the glyph a tile gives an executor of this client. */
function tileDrawing(client: 'claude' | 'codex' | 'other') {
  const glyph = holderGlyph('someone', { client, session: null, stale: false })
  if (!glyph) throw new Error('no glyph')
  const icon = mount(VIcon, {
    props: { name: glyph, size: 14 },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  const drawing = icon.get('svg').element.innerHTML
  icon.unmount()
  return drawing
}

describe("the executor's sign is its client's, as a tile draws it", () => {
  it.each([
    { family: 'claude', word: 'Claude Code' },
    { family: 'codex', word: 'Codex' },
    { family: 'other', word: 'Another client' },
  ] as const)('a $family session opening in VS Code', async ({ family, word }) => {
    answerPlans(plan(vscode, { ...vscode, source: 'recorded' }, windowSteps))
    const wrapper = mountAction({ executor: { ...executor(vscode), family } })
    await flushPromises()
    const button = wrapper.get('button.open-action')
    const marks = button.findAll('.open-action-mark')
    expect(marks.map((mark) => mark.attributes('data-mark'))).toEqual(['client'])
    const [sign] = marks
    expect(sign?.attributes('aria-label')).toBe(word)
    expect(hintOf(sign)).toBe(word)
    // The tile's own drawing, not VS Code's mark.
    expect(sign?.get('svg').element.innerHTML).toBe(tileDrawing(family))
    // The place is what a press does: in the hint and in the button's name.
    expect(hintOf(button)).toBe('Open in VS Code')
    expect(button.attributes('aria-label')).toBe(`Open session ${NAME} in VS Code`)
    wrapper.unmount()
  })

  it('a session running in a terminal says the terminal in its hint, not as its sign', async () => {
    answerPlans(
      plan(
        terminal,
        { ...vscode, source: 'fallback' },
        [{ kind: 'explain', reason: 'live-in-terminal' }, ...windowSteps],
        'live',
      ),
    )
    const wrapper = mountAction({ executor: executor(terminal, 'live') }, 'ru')
    await flushPromises()
    const button = wrapper.get('button.open-action')
    const marks = button.findAll('.open-action-mark').map((mark) => mark.attributes('aria-label'))
    expect(marks).toEqual(['Claude Code', 'идёт'])
    expect(button.find('[data-mark="place"]').exists()).toBe(false)
    expect(button.attributes('aria-label')).toContain('в терминале')
    expect(tooltipOf(button.element)?.note).toBe('идёт в терминале')
    wrapper.unmount()
  })
})
