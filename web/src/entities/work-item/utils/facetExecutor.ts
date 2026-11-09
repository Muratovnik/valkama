/**
 * Who works an open item, as a tile draws its holder: the client whose session holds the
 * claim, what that session is doing as the read model's `live_work` says it, and whether
 * the claim went stale. The facet registry (`facets.ts`) draws it; this module only reads
 * the claim and the live work.
 */

import type { LiveWork, TIMELESS_LIVE_STATES } from '@/shared/api/liveWorkModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import { sessionFamilyOf } from '@/shared/lib/settings.ts'
import type { SessionFamily } from '@/shared/lib/settings.ts'
import type { IconName } from '@/shared/lib/uiSystem.ts'

/** What a session is doing on an item, of what the read model's `live_work` says. */
export type SessionDoing = (typeof TIMELESS_LIVE_STATES)[number]

/** Who holds an open item as its executor: the client, its session's doing, a stale claim. */
export interface Executor {
  client: SessionFamily
  session: SessionDoing | null
  stale: boolean
}

/** The part of an item an executor is read from. */
type Claim = Partial<Pick<WorkItemBrief, 'claim_ref' | 'claim_state'>> & {
  state: { is_terminal?: boolean }
}

/**
 * The executor behind an open item's claim, or null where none stands behind it: a live
 * claim's session, a stale claim's, or a session at work on an item whose claim no session
 * proved. An unconfirmed claim with no session at it is a name and no more. The client is
 * the holder's name, which the server writes as the channel the session proved itself on
 * (`claude (session …)`, `codex (session …)`).
 */
export function executorOf(item: Claim, live: LiveWork | null | undefined): Executor | null {
  const holder = item.claim_ref ?? ''
  if (!holder || item.state.is_terminal) return null
  const stale = item.claim_state === 'stale'
  const doing = live?.state
  const session = stale || doing === undefined || doing === 'quiet' ? null : doing
  return item.claim_state !== 'live' && !stale && session === null
    ? null
    : { client: sessionFamilyOf(actorName(holder)), session, stale }
}

/** A client's own glyph, where the interface has one; any other client is a client. */
const CLIENT_GLYPHS: Readonly<Record<SessionFamily, IconName>> = {
  claude: 'claude',
  codex: 'codex',
  other: 'client',
}

/** The glyph a holder is drawn with: its client's where an executor stands behind the claim. */
export function holderGlyph(holder: string, executor: Executor | null): IconName | null {
  if (executor) return CLIENT_GLYPHS[executor.client]
  return holder ? 'holder' : null
}

/** The words after the holder's name on a tile, by the executor's state. */
export function executorWords(executor: Executor | null): string {
  if (executor?.stale) return 'workItem.facet.heldStale'
  if (executor?.session) return EXECUTOR_WORDS[executor.session]
  return 'workItem.facet.heldBy'
}

const EXECUTOR_WORDS: Readonly<Record<SessionDoing, string>> = {
  working: 'workItem.facet.heldWorking',
  held: 'workItem.facet.heldElsewhere',
  waiting: 'workItem.facet.heldWaiting',
}
