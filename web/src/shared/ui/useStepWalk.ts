/**
 * The places of a step line in the order the keyboard walks them (`StepLine`): the readings shown,
 * the restarts of the window's count among them, each before the reading at its moment
 * (`stepStops`), then the places past the readings (`useStepAhead`). Each has its stop, where the
 * pointer finds it and the moments it covers for a frame stretched with the keyboard: a reading
 * at its mark and along its step, which is both.
 *
 * A restart is a place on the line at its moment, where the line falls with the window's reset
 * unchanged, with its hint, as the forecast at the reset is a place past the readings. Its mark is
 * a ring around the fall the line draws there (`restartFall`), «now»'s ring drawn as tall as the
 * fall, so it never reads as a reading's dot. The pointer finds it at its ring, and at the moment itself before
 * the reading it restarted at, which keeps its step past the ring; its box, which the keyboard's
 * ring is drawn on, is the least width of a box (`--step-reach`) centred on its moment; it covers
 * its moment alone. A restart outside the span shown stands nowhere.
 */
import { computed } from 'vue'
import type { ComputedRef } from 'vue'

import { targetHint } from '@/shared/ui/markHints.ts'
import type { StepTargetPlace } from '@/shared/ui/useStepAhead.ts'
import {
  restartFall,
  STEP_HEIGHT,
  stepAcross,
  stepStops,
  stepY,
} from '@/shared/ui/windowGeometry.ts'
import type {
  StepAim,
  StepFrame,
  StepPoint,
  StepRestart,
  StepSpan,
  StepStop,
} from '@/shared/ui/windowGeometry.ts'

/** A restart as a place of the line: its moment and its key besides what every place has. */
type StepRestartPlace = StepTargetPlace & { at: number; key: string }

/** A reading or restart of the walk: which, where the pointer finds it and what it covers. */
type StepWalk = StepStop & { aim: StepAim; covers: StepSpan }

export function useStepWalk(
  line: () => { points: readonly StepPoint[]; restarts?: readonly StepRestart[] },
  frame: ComputedRef<StepFrame>,
  shown: {
    /** The readings the span shows. */
    inside: () => readonly StepPoint[]
    /** The places past the readings, «now» and the forecast. */
    past: () => readonly StepTargetPlace[]
    /** The step a reading shown holds, by its order among them. */
    step: (index: number) => StepSpan
  },
) {
  const restarts = computed<StepRestartPlace[]>(() => {
    const { points, restarts: all = [] } = line()
    const { from, to } = frame.value
    return all
      .filter((restart) => restart.at >= from && restart.at <= to)
      .map((restart) => {
        const fall = restartFall(points, restart.at)
        const moment = { from: restart.at, to: restart.at }
        return {
          kind: 'restart',
          key: restart.key,
          at: restart.at,
          hint: targetHint(restart, 1),
          reach: {
            start: `calc(${stepAcross(frame.value, restart.at)} - var(--step-reach) / 2)`,
            size: 'var(--step-reach)',
          },
          mark: {
            high: stepY(frame.value, fall.high) / STEP_HEIGHT,
            low: stepY(frame.value, fall.low) / STEP_HEIGHT,
            side: '50%',
          },
          aim: { at: restart.at, ...moment },
          covers: moment,
        }
      })
  })

  /** The readings shown and the restarts among them, in the order they stand. */
  const walk = computed<StepWalk[]>(() =>
    stepStops(shown.inside(), restarts.value).map((stop) => {
      if (stop.kind === 'reading') {
        const step = shown.step(stop.index)
        return { ...stop, aim: { at: step.from, ...step }, covers: step }
      }
      const place = restarts.value[stop.index]
      const at = place?.at ?? 0
      return { ...stop, aim: { at, from: at, to: at }, covers: { from: at, to: at } }
    }),
  )

  /** The stop of each reading shown and of each restart, by its order among its kind. */
  const stopsOf = computed(() => {
    const found = { reading: [] as number[], restart: [] as number[] }
    for (const [stop, { index, kind }] of walk.value.entries()) found[kind][index] = stop
    return found
  })

  /** The places that are no reading, each with its stop: the restarts, «now» and the forecast. */
  const places = computed(() => [
    ...restarts.value.map((place, index) => ({
      ...place,
      stop: stopsOf.value.restart[index] ?? 0,
    })),
    ...shown.past().map((place, index) => ({
      ...place,
      key: place.kind,
      stop: walk.value.length + index,
    })),
  ])

  /** Every place in the order the keyboard walks them, as the pointer finds each. */
  const aims = computed<StepAim[]>(() => [
    ...walk.value.map(({ aim }) => aim),
    ...shown.past().map(({ aim }) => aim),
  ])

  return {
    aims,
    places,
    /** How many places the keyboard walks. */
    count: computed(() => walk.value.length + shown.past().length),
    /** The moments a place covers by its stop: a reading its step, a restart its moment. */
    coveredBy: (stop: number): StepSpan | null =>
      walk.value[stop]?.covers ?? shown.past()[stop - walk.value.length]?.covers ?? null,
    readingStop: (index: number) => stopsOf.value.reading[index] ?? index,
  }
}
