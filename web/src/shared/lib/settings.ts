/** Every event the owner can be notified about; the settings screen lists these. */
export const NOTIFY_EVENTS = [
  'itemCompleted',
  'itemInReview',
  'itemBlocked',
  'sessionEnded',
  'sessionFailed',
  'agentBlocked',
  'agentWaiting',
] as const

export type NotifyEvent = (typeof NOTIFY_EVENTS)[number]

const OPENER_KINDS = ['vscode', 'codex-app', 'terminal', 'cursor', 'custom'] as const
export type OpenerKind = (typeof OPENER_KINDS)[number]
type OpenerAvailability = 'available' | 'unavailable' | 'unknown'
export type CustomCommandError = 'required' | 'too-long'

export interface OpenerCapability {
  availability: OpenerAvailability
  kind: OpenerKind
}

/** How one client's sessions open; `command` is read only for `custom`. */
export interface SessionOpener {
  command: string
  kind: OpenerKind
}

/** Openers are associated per client; unknown clients use `other`. */
const OPENER_CLIENTS = ['claude', 'codex', 'other'] as const
export type OpenerClient = (typeof OPENER_CLIENTS)[number]

const COMPATIBLE_OPENERS: Record<OpenerClient, readonly OpenerKind[]> = {
  claude: ['vscode', 'terminal', 'cursor', 'custom'],
  codex: OPENER_KINDS,
  other: ['vscode', 'cursor', 'custom'],
}

export const MAX_CUSTOM_COMMAND_LENGTH = 400

export interface PlatformSettings {
  notify: Record<NotifyEvent, boolean>
  notifyEnabled: boolean
  openers: Record<OpenerClient, SessionOpener>
}

/**
 * The defaults the owner asked to be sensible without configuration: finished
 * and failed work notifies, the per-turn "waiting for you" stays quiet because
 * it fires on every completed turn of an interactive session.
 */
export const DEFAULT_SETTINGS: PlatformSettings = {
  notifyEnabled: true,
  notify: {
    itemCompleted: true,
    itemInReview: true,
    itemBlocked: true,
    sessionEnded: true,
    sessionFailed: true,
    agentBlocked: true,
    agentWaiting: false,
  },
  openers: {
    claude: { kind: 'vscode', command: '' },
    codex: { kind: 'terminal', command: '' },
    other: { kind: 'vscode', command: '' },
  },
}

export function openerKindsFor(client: OpenerClient): readonly OpenerKind[] {
  return COMPATIBLE_OPENERS[client]
}

function asOpener(raw: unknown, fallback: SessionOpener, client: OpenerClient): SessionOpener {
  if (typeof raw !== 'object' || raw === null) return { ...fallback }
  const candidate = raw as Record<string, unknown>
  return {
    kind: openerKindsFor(client).includes(candidate.kind as OpenerKind)
      ? (candidate.kind as OpenerKind)
      : fallback.kind,
    command: typeof candidate.command === 'string' ? candidate.command : fallback.command,
  }
}

/** Stored settings become one complete structure in the current schema. */
export function mergeSettings(raw: unknown): PlatformSettings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const notifySource = (
    typeof source.notify === 'object' && source.notify !== null ? source.notify : {}
  ) as Record<string, unknown>
  const openerSource = (
    typeof source.openers === 'object' && source.openers !== null ? source.openers : {}
  ) as Record<string, unknown>
  const notify = {} as Record<NotifyEvent, boolean>
  for (const event of NOTIFY_EVENTS) {
    const value = notifySource[event]
    notify[event] = typeof value === 'boolean' ? value : DEFAULT_SETTINGS.notify[event]
  }
  const openers = {} as Record<OpenerClient, SessionOpener>
  for (const client of OPENER_CLIENTS) {
    openers[client] = asOpener(openerSource[client], DEFAULT_SETTINGS.openers[client], client)
  }
  return {
    notifyEnabled:
      typeof source.notifyEnabled === 'boolean'
        ? source.notifyEnabled
        : DEFAULT_SETTINGS.notifyEnabled,
    notify,
    openers,
  }
}

/** Which opener association covers this session's client string. */
export function openerClientOf(client: string): OpenerClient {
  const normalized = client.trim().toLowerCase()
  if (normalized.startsWith('claude')) return 'claude'
  if (normalized.startsWith('codex')) return 'codex'
  return 'other'
}

export function openerFor(client: string, settings: PlatformSettings): SessionOpener {
  return settings.openers[openerClientOf(client)]
}

/** Remove malformed and duplicate IPC entries without inventing missing capabilities. */
export function normalizeOpenerCapabilities(raw: unknown): OpenerCapability[] {
  if (!Array.isArray(raw)) return []
  const byKind = new Map<OpenerKind, OpenerAvailability>()
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const candidate = entry as Record<string, unknown>
    if (!OPENER_KINDS.includes(candidate.kind as OpenerKind)) continue
    if (!['available', 'unavailable', 'unknown'].includes(String(candidate.availability))) continue
    byKind.set(candidate.kind as OpenerKind, candidate.availability as OpenerAvailability)
  }
  return OPENER_KINDS.flatMap((kind) => {
    const availability = byKind.get(kind)
    return availability === undefined ? [] : [{ kind, availability }]
  })
}

/** Choices are exactly what this client understands and this surface can open now. */
export function availableOpenerCapabilities(
  client: OpenerClient,
  catalog: unknown,
): OpenerCapability[] {
  const compatible = new Set(openerKindsFor(client))
  return normalizeOpenerCapabilities(catalog).filter(
    ({ availability, kind }) => availability === 'available' && compatible.has(kind),
  )
}

/** Keep a valid choice; otherwise move to the first current capability in product order. */
export function reconcileOpener(
  client: OpenerClient,
  opener: SessionOpener,
  catalog: unknown,
): SessionOpener {
  const available = availableOpenerCapabilities(client, catalog)
  if (available.some(({ kind }) => kind === opener.kind)) return opener
  const replacement = available[0]?.kind
  return replacement === undefined ? opener : { command: opener.command, kind: replacement }
}

/** The main process enforces the same two bounds before it can spawn a custom command. */
export function validateCustomCommand(command: string): CustomCommandError | null {
  if (!command.trim()) return 'required'
  return command.length > MAX_CUSTOM_COMMAND_LENGTH ? 'too-long' : null
}

/** A browser can hand off a VS Code URL or copy a custom command; it cannot spawn apps. */
export function browserOpenerCapabilities(): OpenerCapability[] {
  return OPENER_KINDS.map((kind) => ({
    kind,
    availability: kind === 'vscode' || kind === 'custom' ? 'available' : 'unavailable',
  }))
}
