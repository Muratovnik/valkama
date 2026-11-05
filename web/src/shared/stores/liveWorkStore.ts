import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import type { LiveFrame } from '@/shared/api/liveFrameModel.ts'
import { pinWorkItem } from '@/shared/api/planningApi.ts'
import { departures, liveCount, shownSpaces } from '@/shared/lib/liveWorkRows.ts'
import type { DepartedRow } from '@/shared/lib/liveWorkRows.ts'

/** How long a row the frame dropped stays, muted, before it goes. */
export const FADING_MS = 20_000

interface Fading extends DepartedRow {
  reference: string
  /** Its time is up, and it waits only for the pointer or focus to leave it. */
  spent: boolean
}

/**
 * Where work is going on now, as the latest live-work frame says, for every surface
 * that shows it: the rail's list, the phone's panel and a card's pin.
 *
 * The frame arrives through whichever stream the tab holds, and a pin answers with
 * one too; each replaces the last whole. The frame keeps no memory of a row it
 * dropped, so this does: such a row stays, muted, for twenty seconds, and longer
 * while the pointer or focus is on it, so a row never leaves from under the hand
 * that is about to press it.
 */
export const useLiveWorkStore = defineStore('liveWork', () => {
  const frame = shallowRef<LiveFrame | null>(null)
  const fading = ref<Fading[]>([])
  /** How many surfaces hold each row: the pointer over it, focus in it. */
  const held = new Map<string, number>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const spaces = computed(() => shownSpaces(frame.value, fading.value))
  const count = computed(() => liveCount(frame.value))

  function forget(reference: string) {
    clearTimeout(timers.get(reference))
    timers.delete(reference)
    fading.value = fading.value.filter((entry) => entry.reference !== reference)
  }

  function expire(reference: string) {
    timers.delete(reference)
    if ((held.get(reference) ?? 0) > 0) {
      const entry = fading.value.find((candidate) => candidate.reference === reference)
      if (entry) entry.spent = true
      return
    }
    forget(reference)
  }

  function accept(next: LiveFrame) {
    const left = frame.value === null ? [] : departures(spaces.value, next)
    const back = new Set(next.spaces.flatMap((space) => space.rows.map((row) => row.reference)))
    for (const entry of fading.value) if (back.has(entry.reference)) forget(entry.reference)
    frame.value = next
    if (left.length === 0) return
    fading.value = [
      ...fading.value,
      ...left.map(({ reference, departed }) => ({ ...departed, reference, spent: false })),
    ]
    for (const { reference } of left)
      timers.set(
        reference,
        setTimeout(() => expire(reference), FADING_MS),
      )
  }

  /** The pointer or focus came onto a row, or left it. */
  function hold(reference: string, on: boolean) {
    const now = Math.max(0, (held.get(reference) ?? 0) + (on ? 1 : -1))
    held.set(reference, now)
    if (now > 0) return
    held.delete(reference)
    if (fading.value.some((entry) => entry.reference === reference && entry.spent))
      forget(reference)
  }

  /** Whether the item is pinned; null until a frame says. Every pinned item is a row. */
  function pinned(reference: string): boolean | null {
    return (
      frame.value?.spaces.some((space) =>
        space.rows.some((row) => row.reference === reference && row.pinned),
      ) ?? null
    )
  }

  /** Pin an item or take its pin away; the answer is the frame as it now stands. */
  async function pin(reference: string, on: boolean) {
    accept(await pinWorkItem({ id: reference, pinned: on }))
  }

  return { accept, count, frame, hold, pin, pinned, spaces }
})
