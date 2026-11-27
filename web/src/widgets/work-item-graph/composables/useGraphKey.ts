/**
 * What the key above the field names beside the chain's groups — the lines, the motion
 * of live work and the sessions' signs — and the places it keeps for what a fold hides.
 *
 * The key names only what the field draws. A fold hides cards, and with them the signs
 * and the lines they drew; were the key to drop those words, the strip above the field
 * would lose a row and the field would move under the hand that pressed the fold. So the
 * key keeps, unseen, the place of what the field would draw were every frame open
 * (`drawable`), as it keeps the place of «Done» while the closed switch is off.
 */

import { computed } from 'vue'
import type { Ref } from 'vue'

import { movesOn, signsOf } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'
import type { FrameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import type { LiveWork, PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { PlanningEdge } from '@/shared/api/planningModel.ts'

interface KeyInput {
  drawn: Ref<GraphLayout | null>
  live: Ref<Readonly<Record<string, LiveWork>>>
  projected: Ref<FrameProjection | null>
  edges: () => readonly PlanningEdge[]
  /** The field is zoomed out past reading, where the cards draw no sign. */
  overview: () => boolean
}

export function useGraphKey(input: KeyInput) {
  /**
   * The items whose live work moves: an agent is seen working on them now. A line runs when
   * one of its links reaches one, and a frame counts those under it. It stays the whole
   * space's set: a drawn line folded onto a frame reaches items no card shows.
   */
  const moving = computed(
    () => new Set(Object.keys(input.live.value).filter((id) => movesOn(input.live.value[id]))),
  )
  const cards = computed(() => input.drawn.value?.nodes.map((node) => node.work_item_id) ?? [])
  /** What the field would draw were every frame open; a flat field folds nothing. */
  const drawable = computed(
    () => input.projected.value?.drawable ?? { cards: cards.value, frames: [] },
  )
  const workingIn = (frame: PlacedFrame) =>
    frame.members.filter((id) => moving.value.has(id)).length
  /**
   * Something on the field moves: a drawn card being worked on, or a drawn frame, folded or
   * open, that counts work moving under it. Only then do the key and the switch speak of
   * motion; a fold keeps a frame's count, so it never adds or drops that word.
   */
  const anyMoving = computed(
    () =>
      cards.value.some((id) => moving.value.has(id)) ||
      (input.drawn.value?.frames ?? []).some((frame) => workingIn(frame) > 0),
  )
  const signsAmong = (ids: readonly string[]) =>
    input.overview() ? [] : signsOf(ids.map((id) => input.live.value[id]))
  /** The sessions' signs the drawn cards show, and none zoomed out past reading. */
  const signs = computed(() => signsAmong(cards.value))
  /** The signs the cards a fold hides would show too: their places are kept. */
  const keptSigns = computed(() => signsAmong(drawable.value.cards))
  const hasEdges = computed(() => Boolean(input.drawn.value?.edges.length))
  /** A link the field would draw were every frame open: its place is kept. */
  const keepEdges = computed(() => {
    const ends = new Set([...drawable.value.cards, ...drawable.value.frames])
    return input
      .edges()
      .some((edge) => edge.kind !== 'parent' && ends.has(edge.from) && ends.has(edge.to))
  })
  return {
    anyMoving,
    drawableCards: computed(() => drawable.value.cards),
    hasEdges,
    keepEdges,
    keptSigns,
    moving,
    signs,
    workingIn,
  }
}
