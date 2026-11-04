/**
 * What a panel's action says: where it leads, standing on its own, since the panel
 * offers the actions one at a time and a later one is read without the one before it.
 * The places are every one a plan's step can name, and the words the dictionary's.
 */
import { describe, expect, it } from 'vitest'

import type { OpenAction } from '@/features/session-open/openPlan.ts'
import { actionWords } from '@/features/session-open/placeWords.ts'

import { i18n } from '@/shared/i18n/index.ts'

const t = i18n.global.t
const FOLDER = 'C:\\work\\example-project'

const nothing: OpenAction['run'] = async () => ({
  status: 'refused',
  refusal: { reason: 'no-session' },
})
const action = (step: Record<string, unknown>): OpenAction => ({
  steps: [step as unknown as OpenAction['steps'][number]],
  run: nothing,
})
const link = (scheme: string) => action({ kind: 'open-link', scheme, link: `${scheme}://x` })

describe('an action of the panel', () => {
  it('names where it leads, for every place a step can name', () => {
    const editors = {
      'vscode': 'VS Code',
      'vscode-insiders': 'VS Code Insiders',
      'cursor': 'Cursor',
      'windsurf': 'Windsurf',
    }
    for (const [ide, word] of Object.entries(editors)) {
      const folder = action({ kind: 'focus-folder', ide, folder: FOLDER })
      expect(actionWords(t, folder)).toBe(`Open the project window in ${word}`)
      expect(actionWords(t, action({ kind: 'open-file', ide, path: FOLDER }))).toBe(
        `Open the file in ${word}`,
      )
      expect(actionWords(t, link(ide))).toBe(`Open the session in ${word}`)
    }
    expect(actionWords(t, link('claude'))).toBe('Open the session in Claude Desktop')
    expect(actionWords(t, link('codex'))).toBe('Open the session in Codex')
    expect(actionWords(t, link('claude-cli'))).toBe('Open the session in a terminal')
    expect(actionWords(t, action({ kind: 'resume-in-terminal' }))).toBe('Resume in a terminal')
    expect(actionWords(t, action({ kind: 'desktop-resume' }))).toBe('Open in Claude Desktop')
    expect(actionWords(t, action({ kind: 'copy', text: 'claude --resume x' }))).toBe(
      'Copy the command',
    )
    // The app's own opening names no step: it is the opening itself.
    expect(actionWords(t, { steps: [], run: nothing })).toBe('Open session')
    i18n.global.locale.value = 'ru'
    try {
      expect(actionWords(t, action({ kind: 'focus-folder', ide: 'cursor', folder: FOLDER }))).toBe(
        'Открыть окно проекта в Cursor',
      )
      expect(actionWords(t, link('claude-cli'))).toBe('Открыть сессию в терминале')
    } finally {
      i18n.global.locale.value = 'en'
    }
  })
})
