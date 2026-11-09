/**
 * The owner's local preferences: opening sessions and files, whether a card offers
 * its Execution tab, the colours of the work item kinds, whether the standard workflow
 * states read in the interface's language, and the views saved in each planning space
 * (`savedViews.ts`).
 *
 * A session opens where it was last open; the server decides that. What the owner
 * sets here is only what the rule falls back to, per client family, and an
 * explicit "always open in …" that replaces the rule for a family. A file or a
 * folder opens in one editor. The tab is off until the owner turns it on, which decides
 * only whether a card offers a launch, never whether a launch can run. `mergeSettings` is
 * the one reader of what a build stored, including the shape every build before this one
 * wrote.
 */

import { EDITORS } from '@/shared/api/openPlanModel.ts'
import type { Editor, OpenPlace } from '@/shared/api/openPlanModel.ts'
import { readKindColors } from '@/shared/lib/kindColors.ts'
import type { KindColors } from '@/shared/lib/kindColors.ts'
import { readSavedViews } from '@/shared/lib/savedViews.ts'
import type { SavedViews } from '@/shared/lib/savedViews.ts'
import { STATE_NAMINGS } from '@/shared/lib/stateNames.ts'
import type { StateNaming } from '@/shared/lib/stateNames.ts'

/** Sessions are set per client family; a client Valkama cannot resume is `other`. */
export const SESSION_FAMILIES = ['claude', 'codex', 'other'] as const
export type SessionFamily = (typeof SESSION_FAMILIES)[number]
/** "Always open in": nothing (the rule), a place, or the owner's own command. */
export type AlwaysChoice = '' | OpenPlace | 'custom'
export type CustomCommandError = 'required' | 'too-long'

interface SessionOpening {
  always: AlwaysChoice
  /** Read only for `always: 'custom'`, and kept when another choice is made. */
  command: string
  /** Where a session goes when its place is unknown or cannot be opened. */
  fallback: OpenPlace
}

export interface PlatformSettings {
  editor: Editor
  executionTab: boolean
  /** Only what the owner chose; a kind not here takes the stylesheet's default. */
  kindColors: KindColors
  sessions: Record<SessionFamily, SessionOpening>
  /** How a workflow state is named on screen: the standard ones translated, or every one as written. */
  stateNames: StateNaming
  /** Named address states, by the planning space they were saved in. */
  views: SavedViews
}

export const MAX_CUSTOM_COMMAND_LENGTH = 400

const EDITOR_PLACES: readonly OpenPlace[] = EDITORS
/** The places that can hold a family's sessions: another client's app cannot. */
const FAMILY_PLACES: Record<SessionFamily, readonly OpenPlace[]> = {
  claude: [...EDITOR_PLACES, 'terminal', 'claude-desktop'],
  codex: [...EDITOR_PLACES, 'terminal', 'codex-app'],
  // Valkama knows no way to resume these; only the owner's command opens them.
  other: [],
}

const DEFAULT_OPENING: SessionOpening = { fallback: 'vscode', always: '', command: '' }

export const DEFAULT_SETTINGS: PlatformSettings = {
  editor: 'vscode',
  executionTab: false,
  kindColors: {},
  sessions: {
    claude: { ...DEFAULT_OPENING },
    codex: { ...DEFAULT_OPENING },
    other: { ...DEFAULT_OPENING },
  },
  stateNames: 'translated',
  views: {},
}

export function placesFor(family: SessionFamily): readonly OpenPlace[] {
  return FAMILY_PLACES[family]
}

export function alwaysChoicesFor(family: SessionFamily): readonly AlwaysChoice[] {
  return ['', ...FAMILY_PLACES[family], 'custom']
}

function record(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function fallbackOf(family: SessionFamily, value: unknown): OpenPlace {
  return placesFor(family).includes(value as OpenPlace) ? (value as OpenPlace) : 'vscode'
}

function alwaysOf(family: SessionFamily, value: unknown): AlwaysChoice {
  return alwaysChoicesFor(family).includes(value as AlwaysChoice) ? (value as AlwaysChoice) : ''
}

function opening(family: SessionFamily, raw: unknown): SessionOpening {
  const source = record(raw)
  return {
    fallback: fallbackOf(family, source.fallback),
    always: alwaysOf(family, source.always),
    command: text(source.command),
  }
}

/**
 * What a build before this one stored: one opener per family, of which `vscode`
 * and `cursor` opened the session's folder rather than the session. Each becomes
 * the fallback it named, and the owner's command stays the owner's command. Those
 * builds saved `terminal` for Codex by default, so it says nothing about a choice
 * and Codex takes today's default like a family that never stored anything.
 */
function translated(family: SessionFamily, raw: unknown): SessionOpening {
  const source = record(raw)
  const command = text(source.command)
  if (source.kind === 'custom') return { ...DEFAULT_OPENING, always: 'custom', command }
  const named = family === 'codex' && source.kind === 'terminal' ? undefined : source.kind
  return { fallback: fallbackOf(family, named), always: '', command }
}

/**
 * Stored settings become one complete structure in the current shape. Anything
 * else in the stored value goes, such as the `notify` fields of older builds.
 */
export function mergeSettings(raw: unknown): PlatformSettings {
  const source = record(raw)
  const current = record(source.sessions)
  const former = record(source.openers)
  const sessions = {} as Record<SessionFamily, SessionOpening>
  for (const family of SESSION_FAMILIES) {
    if (family in current) sessions[family] = opening(family, current[family])
    else if (family in former) sessions[family] = translated(family, former[family])
    else sessions[family] = { ...DEFAULT_OPENING }
  }
  const editor = EDITORS.includes(source.editor as Editor) ? (source.editor as Editor) : 'vscode'
  // Only what this setting itself stored turns it on, so every older shape reads as off.
  return {
    editor,
    executionTab: source.executionTab === true,
    kindColors: readKindColors(source.kindColors),
    sessions,
    stateNames: STATE_NAMINGS.includes(source.stateNames as StateNaming)
      ? (source.stateNames as StateNaming)
      : 'translated',
    views: readSavedViews(source.views),
  }
}

/** Which family's settings cover this session's client string. */
export function sessionFamilyOf(client: string): SessionFamily {
  const normalized = client.trim().toLowerCase()
  if (normalized.startsWith('claude')) return 'claude'
  if (normalized.startsWith('codex')) return 'codex'
  return 'other'
}

/** The main process enforces the same two bounds before it can spawn a custom command. */
export function validateCustomCommand(command: string): CustomCommandError | null {
  if (!command.trim()) return 'required'
  return command.length > MAX_CUSTOM_COMMAND_LENGTH ? 'too-long' : null
}
