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
  const value = (raw ?? '').trim()
  const match = ACTOR_SESSION.exec(value)
  if (!match) return { name: value, session: '' }
  const name = match[1].trim()
  // "(session x)" with no name before it stays as it was written: an empty
  // executor column would claim nobody holds the work.
  if (!name) return { name: value, session: match[2] }
  return { name, session: match[2] }
}

export function actorName(raw: string): string {
  return splitActor(raw).name
}

export function actorSession(raw: string): string {
  return splitActor(raw).session
}
