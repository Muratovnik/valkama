/**
 * The sign of what a session is doing, wherever it is drawn (`SessionSign`): one ring of
 * one size, its inside saying the state. A session at work turns; one that stopped in the
 * middle of a turn to ask a person asks; one whose turn is over waits; one at work on other
 * items holds this one; one silent for over a day is quiet. A waiting session that asks is
 * the one wait a person can end now, so it is a sign of its own.
 *
 * A live state is the read model's `live_work` and the live-work frame's, and `asks` is what
 * either says beside a waiting one. No state, no sign.
 */
import type { LiveState } from '@/shared/api/liveWorkModel.ts'

export type LiveSign = 'working' | 'asks' | 'waiting' | 'held' | 'quiet'

/** The sign of a live state; `asks` counts only for a waiting one. */
export function liveSign(state: LiveState | null | undefined, asks = false): LiveSign | null {
  if (state === null || state === undefined) return null
  if (state === 'waiting' && asks) return 'asks'
  return state
}
