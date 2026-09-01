import type { SessionOpener } from '@/shared/lib/settings'
import type { SpaceRootResolution, SpaceRootStatus } from '@/shared/types/reference.ts'

/**
 * Opening a session in its associated program. The plan is computed here so
 * every surface behaves identically; execution prefers the desktop bridge,
 * falls back to a protocol URL the OS can route, and degrades to copying the
 * exact command when nothing on this surface may spawn a process.
 */

export interface SessionTarget {
  client: string
  /** Observed session cwd; retained for display and custom-command context only. */
  cwd: string
  id: string
  client_family?: 'codex' | 'claude' | 'other'
  session_cwd?: string
  space_root?: SpaceRootResolution
}

export type OpenPlan =
  | { mode: 'url'; url: string }
  | { argv: string[]; cwd: string; display: string; mode: 'spawn' }
  | {
      mode: 'refused'
      reason:
        | 'no-cwd'
        | 'no-session'
        | 'no-command'
        | 'space-root-unavailable'
        | 'unsupported-client'
        | 'invalid-session'
        | 'desktop-required'
    }

// Codex task identifiers currently use UUIDv7. Keep the accepted versions
// aligned with RFC 9562 instead of silently limiting launches to UUIDv1-v5.
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function effectiveSessionCwd(target: SessionTarget): string {
  const root = target.space_root
  if (root?.status === 'mapped' && root.resource_ref && root.canonical_root) {
    return root.canonical_root
  }
  return ''
}

function observedSessionCwd(target: SessionTarget): string {
  return target.session_cwd || target.cwd || ''
}

/** vscode://file/c:/path — the folder form VS Code's own URL handler accepts. */
export function vscodeFolderUrl(path: string): string {
  const forward = path.replaceAll('\\', '/').replace(/\/+$/, '')
  const rooted = forward.startsWith('/') ? forward : `/${forward}`
  return `vscode://file${encodeURI(rooted)}`
}

/** Split a custom template into argv, honoring double quotes, then substitute. */
export function customArgv(template: string, target: SessionTarget): string[] {
  const tokens = template.match(/"[^"]*"|\S+/g) ?? []
  return tokens
    .map((token) => (token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token))
    .map((token) =>
      token
        .replaceAll('{session}', target.id)
        .replaceAll('{cwd}', effectiveSessionCwd(target))
        .replaceAll('{session_cwd}', observedSessionCwd(target)),
    )
    .filter((token) => token.length > 0)
}

function display(argv: string[]): string {
  return argv.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ')
}

/**
 * How each client is told to resume a session it already owns.
 *
 * Ordered, and matched by prefix, because the reported client carries a version
 * suffix more often than not.
 */
const RESUME_COMMANDS = [
  { prefix: 'claude', argv: (id: string) => ['claude', '--resume', id] },
  { prefix: 'codex', argv: (id: string) => ['codex', 'resume', id] },
] as const

/**
 * The Codex app always refuses here and says why.
 *
 * The desktop bridge is the only surface that can hand a session to the app, so
 * a browser tab's job is to report which of the three reasons applies rather
 * than to pretend it could have opened it.
 */
function planCodexApp(target: SessionTarget): OpenPlan {
  if (target.client_family !== 'codex') return { mode: 'refused', reason: 'unsupported-client' }
  if (!SESSION_UUID.test(target.id)) return { mode: 'refused', reason: 'invalid-session' }
  return { mode: 'refused', reason: 'desktop-required' }
}

/** A terminal resumes the session in the client that owns it. */
function planTerminal(target: SessionTarget, cwd: string): OpenPlan {
  if (!target.id) return { mode: 'refused', reason: 'no-session' }
  const family = target.client.trim().toLocaleLowerCase()
  const resume = RESUME_COMMANDS.find((entry) => family.startsWith(entry.prefix))
  if (!resume) return { mode: 'refused', reason: 'unsupported-client' }
  const argv = resume.argv(target.id)
  return { mode: 'spawn', argv, cwd, display: display(argv) }
}

/** An operator-configured command line, refused when it expands to nothing. */
function planCustomCommand(command: string, target: SessionTarget, cwd: string): OpenPlan {
  if (!command.trim()) return { mode: 'refused', reason: 'no-command' }
  const argv = customArgv(command, target)
  if (!argv.length) return { mode: 'refused', reason: 'no-command' }
  return { mode: 'spawn', argv, cwd, display: display(argv) }
}

export function planSessionOpen(target: SessionTarget, opener: SessionOpener): OpenPlan {
  if (
    target.space_root?.status !== 'mapped' ||
    !target.space_root.resource_ref ||
    !target.space_root.canonical_root
  ) {
    return { mode: 'refused', reason: 'space-root-unavailable' }
  }
  const cwd = effectiveSessionCwd(target)
  if (opener.kind === 'codex-app') return planCodexApp(target)
  if (opener.kind === 'vscode') {
    if (!cwd) return { mode: 'refused', reason: 'no-cwd' }
    return { mode: 'url', url: vscodeFolderUrl(cwd) }
  }
  if (opener.kind === 'cursor') {
    if (!cwd) return { mode: 'refused', reason: 'no-cwd' }
    const argv = ['cursor', cwd]
    return { mode: 'spawn', argv, cwd, display: display(argv) }
  }
  if (opener.kind === 'terminal') return planTerminal(target, cwd)
  return planCustomCommand(opener.command, target, cwd)
}

export interface SessionOpenResult {
  mode: 'opened' | 'copied' | 'refused'
  ok: boolean
  command?: string
  /** Main-process trust metadata returned after a successful launch. */
  cwd?: string
  error?: string
  fallback?: boolean
  source?: string | Record<string, unknown>
  status?: SpaceRootStatus
}

/**
 * Execute the plan on whatever surface this page has. The desktop bridge gets
 * the raw target and opener and re-derives the plan on its side of the trust
 * boundary; this function never hands a shell a pre-built command line.
 */
export async function openSession(
  target: SessionTarget,
  opener: SessionOpener,
): Promise<SessionOpenResult> {
  const bridge = window.valkamaDesktop
  if (bridge?.openSession) {
    return bridge.openSession({
      id: target.id,
      client: target.client,
      client_family: target.client_family,
      session_cwd: observedSessionCwd(target),
      resource_ref: target.space_root?.resource_ref ?? null,
      opener: { kind: opener.kind, command: opener.command },
    })
  }
  const plan = planSessionOpen(target, opener)
  if (plan.mode === 'url') {
    window.open(plan.url, '_blank', 'noreferrer')
    return { ok: true, mode: 'opened' }
  }
  if (plan.mode === 'spawn') {
    try {
      await navigator.clipboard.writeText(plan.display)
      return { ok: true, mode: 'copied', command: plan.display }
    } catch (error) {
      return {
        ok: false,
        mode: 'copied',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
  return { ok: false, mode: 'refused', error: plan.reason }
}
