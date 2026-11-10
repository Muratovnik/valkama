/**
 * Whether live work moves on the graph: `running`, `paused` by the reader, or
 * `reduced` because the system asked for less motion.
 *
 * Only an item an agent is working on right now moves: one its running turn
 * wrote to, or one a live subagent of its session wrote to, holds a step of or
 * was launched to work on by its number. The session's other items stand still
 * «held», while it has a turn running or a subagent alive; a session that
 * finished its turn and waits for a person, with no subagent alive, stands still
 * with the word «waiting», one stopped in the middle of its turn to ask a person
 * stands still with «asking», and one silent for a day stands still with the time
 * it fell silent: motion that also meant holding or idling would stop telling work
 * from waiting.
 *
 * Moving work starts by itself and lasts as long as the work, beside the rest
 * of the field, so the reader can stop it (WCAG 2.2.2): one switch for every
 * graph, kept in this browser across reloads and every space, never in the
 * address a link carries. Storage that refuses a write keeps the choice for as
 * long as the page. Reduced motion outranks the switch, and then there is no
 * switch to offer: nothing moves.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useMediaQuery, useStorage } from '@vueuse/core'

import type { LiveWork } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { liveSign } from '@/shared/lib/liveSign.ts'
import type { LiveSign } from '@/shared/lib/liveSign.ts'

export type GraphMotion = 'paused' | 'reduced' | 'running'

const STORAGE_KEY = 'valkama-graph-motion'

/**
 * «Silent since» names the day alone: a session is called silent only after a
 * day without a sign, so the hour adds nothing a reader acts on, and it made
 * the word too long to stand beside a holder's name on a card.
 */
const QUIET_DAY = { month: 'short', day: '2-digit' } as const

/** Whether an item's live work is the kind that moves: an agent is seen working on it now. */
export function movesOn(live: LiveWork | undefined): boolean {
  return live?.state === 'working'
}

/**
 * The word a card says for its live work, one for each sign it draws (`liveSign`):
 * «working», «asking» for a session stopped in the middle of a turn for a person, «held»,
 * «waiting» for one whose turn is over, or «silent since» the session's last sign of life.
 * Silence proves nothing, so a silent session is not called ended; the graph says what the
 * session's panel says.
 */
export function useLiveWord() {
  const { d, t } = useI18n()
  return (live: LiveWork): string =>
    live.state === 'quiet'
      ? t('graph.live.quiet', { since: d(new Date(live.quiet_since), QUIET_DAY) })
      : t(`graph.live.${signOf(live)}`)
}

/** The sign a card draws for its live work: a waiting session that asks is a sign of its own. */
export const signOf = (live: LiveWork): LiveSign =>
  liveSign(live.state, live.state === 'waiting' && live.asks) ?? live.state

/** The order the key names the signs in: from work going on to a session fallen silent. */
const SIGN_ORDER: readonly LiveSign[] = ['working', 'asks', 'waiting', 'held', 'quiet']

/** The signs some of `lives` draw, once each, in the key's order. */
export function signsOf(lives: Iterable<LiveWork | undefined>): LiveSign[] {
  const drawn = new Set([...lives].flatMap((live) => (live ? [signOf(live)] : [])))
  return SIGN_ORDER.filter((sign) => drawn.has(sign))
}

export function useGraphMotion() {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const stored = useStorage<string>(
    STORAGE_KEY,
    'running',
    typeof localStorage === 'undefined' ? undefined : localStorage,
    {
      writeDefaults: false,
      onError() {
        // Storage that refuses a write keeps the choice for as long as the page.
      },
    },
  )
  const motion = computed<GraphMotion>(() => {
    if (reduced.value) return 'reduced'
    return stored.value === 'paused' ? 'paused' : 'running'
  })

  /** Stop the motion, or let it run again. */
  function toggle() {
    stored.value = motion.value === 'paused' ? 'running' : 'paused'
  }

  return { motion, toggle }
}
