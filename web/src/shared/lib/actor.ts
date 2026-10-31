/**
 * Agents sign claims and events as "name (session 1baa03d7)". That habit is
 * useful provenance but wrong typography: the name column must show a name,
 * and the session belongs in the session slot. This is the one parser every
 * surface uses, so the split cannot drift between components.
 */

export interface ActorParts {
  name: string
  /** Session id or prefix carried inside the actor string, '' when none. */
  session: string
}

const ACTOR_SESSION =
  /^(.*?)[\s·—-]*[([]\s*(?:session|сессия)[:#\s]*([0-9a-f][0-9a-f-]{5,})\s*[)\]]$/i

export function splitActor(raw: string): ActorParts {
  const value = typeof raw === 'string' ? raw.trim() : ''
  const match = ACTOR_SESSION.exec(value)
  if (!match) return { name: value, session: '' }
  const name = match[1].trim()
  // "(session x)" with no name before it stays as it was written: an empty
  // executor column would claim nobody holds the work.
  return name ? { name, session: match[2] } : { name: value, session: match[2] }
}

export function actorName(raw: string): string {
  return splitActor(raw).name
}

export function actorSession(raw: string): string {
  return splitActor(raw).session
}

/** How many characters of a session id tell two holders apart at a glance. */
const SESSION_PREFIX = 8

/**
 * Who holds a work item or a step, as every surface prints it. The server
 * names a holder whose client proved its session `claude (session 5937…)`,
 * so two sessions of one client read as two holders: the name, then the
 * start of the session id. A holder with no session is its name alone.
 */
export function holderName(raw: string): string {
  const { name, session } = splitActor(raw)
  return session && name !== raw.trim() ? `${name} · ${session.slice(0, SESSION_PREFIX)}` : name
}
