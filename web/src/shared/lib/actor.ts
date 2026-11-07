/**
 * Agents sign claims and events as "name (session 1baa03d7)", and some of them
 * as "name session 1baa03d7" with no brackets. That habit is useful provenance
 * but wrong typography: the name column must show a name, and the session belongs
 * in the session slot. This is the one parser every surface uses, so the split
 * cannot drift between components.
 */

export interface ActorParts {
  name: string
  /** Session id or prefix carried inside the actor string, '' when none. */
  session: string
}

const ACTOR_SESSION =
  /^(.*?)[\s·—-]*(?:[([]\s*(?:session|сессия)[:#\s]*([0-9a-f][0-9a-f-]{5,})\s*[)\]]|(?:^|\s)(?:session|сессия)[:#\s]+([0-9a-f][0-9a-f-]{5,}))$/i

export function splitActor(raw: string): ActorParts {
  const value = typeof raw === 'string' ? raw.trim() : ''
  const match = ACTOR_SESSION.exec(value)
  if (!match) return { name: value, session: '' }
  const name = match[1].trim()
  const session = match[2] ?? match[3]
  // "(session x)" with no name before it stays as it was written: an empty
  // executor column would claim nobody holds the work.
  return name ? { name, session } : { name: value, session }
}

export function actorName(raw: string): string {
  return splitActor(raw).name
}

export function actorSession(raw: string): string {
  return splitActor(raw).session
}

/**
 * How many characters of a session id tell two holders apart at a glance: its
 * first two groups. Codex ids are UUIDv7, whose first 48 bits are the start
 * time in milliseconds, so the first group alone repeats for sessions started
 * within about a minute of each other.
 */
const SESSION_PREFIX = 13

/** The start of a session id, as every surface prints it; the whole id is for a tooltip or a link. */
export function sessionStart(session: string): string {
  return session.slice(0, SESSION_PREFIX)
}

/**
 * Who holds a work item or a step, as every surface prints it. The server
 * names a holder whose client proved its session `claude (session 5937…)`,
 * so two sessions of one client read as two holders: the name, then the
 * start of the session id. A holder with no session is its name alone.
 */
export function holderName(raw: string): string {
  const { name, session } = splitActor(raw)
  return session && name !== raw.trim() ? `${name} · ${sessionStart(session)}` : name
}

/** A session no holder names, as a holder of it would print: its client, if known, and its start. */
export function sessionName(client: string, session: string): string {
  const start = sessionStart(session)
  return client ? `${client} · ${start}` : start
}
