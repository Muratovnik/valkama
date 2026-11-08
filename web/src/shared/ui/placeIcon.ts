/**
 * The glyph a place to open in draws, by the name the server gives the place: its host when
 * there is one, else how it is open. One table, so a better glyph for a client reaches every
 * place that draws it at once: Settings' choices of where to open and a session's open
 * action both read it. The glyph itself is `ControlIcon`'s.
 */
import type { ControlIconName } from '@/shared/ui/choiceControls.ts'

const PLACE_ICONS: Readonly<Record<string, ControlIconName>> = {
  'vscode': 'vscode',
  'vscode-insiders': 'vscode',
  'cursor': 'cursor',
  'windsurf': 'editor',
  'jetbrains': 'editor',
  'ide': 'editor',
  'ide-terminal': 'terminal',
  'terminal': 'terminal',
  'claude-cli': 'terminal',
  'claude-desktop': 'claude',
  'codex-app': 'codex',
  'app': 'client',
  'background': 'client',
  // The owner's own command, which a setting puts where a place would stand.
  'custom': 'command',
}

/** The place's glyph, or null for a place this table does not know, which then says its word. */
export function placeIcon(place: string): ControlIconName | null {
  return PLACE_ICONS[place] ?? null
}
