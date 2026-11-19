import { computed, shallowRef, watch } from 'vue'

import { useSettingFailureText } from '@/pages/settings/composables/useParticipation.ts'
import { useStoredRecord } from '@/pages/settings/composables/useStoredRecord.ts'

import { writeLaunchPlace } from '@/shared/api/participationApi.ts'
import type { LaunchPlace } from '@/shared/api/participationApi.ts'
import { fetchPlanning } from '@/shared/api/planningApi.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { byUse } from '@/shared/lib/byUse.ts'

type PlaceRecord = ReturnType<typeof useStoredRecord<LaunchPlace, 'launch'>>

/**
 * What the participation tab reads from the space itself: where its launches run, and the
 * labels its work carries, which a label's rule is added from.
 *
 * The launch place is a field of the space's record with its own write, not a value of the
 * participation setting, so it has its own queue, its own way back on a refusal and its own
 * refresh from the answer, and a refused participation write never touches it. Both come
 * from one read of the space, the one the board takes.
 */
export function useSpacePlace(space: () => PlanningSpaceRef | null) {
  const failureText = useSettingFailureText()
  const labels = shallowRef<readonly string[]>([])
  const records = new Map<string, PlaceRecord>()

  function placeRecord(ref: PlanningSpaceRef): PlaceRecord {
    return useStoredRecord<LaunchPlace, 'launch'>({
      read: async () => {
        const model = await fetchPlanning(ref)
        if (model.planning_space === null) throw new Error('the space is not there')
        labels.value = byUse(model.work_items.flatMap((item) => item.labels))
        return model.planning_space.launch_place
      },
      write: (place) => writeLaunchPlace(ref.space_key, place),
      failureText,
    })
  }

  const stored = computed(() => {
    const ref = space()
    if (ref === null) return null
    const name = `${ref.data_scope_id}/${ref.space_key}`
    let found = records.get(name)
    if (found === undefined) {
      found = placeRecord(ref)
      records.set(name, found)
    }
    return found
  })

  watch(
    () => stored.value,
    (next) => {
      labels.value = []
      void next?.load()
    },
    { immediate: true },
  )

  return {
    /** Null until it has been read, and with no space chosen. */
    place: computed(() => stored.value?.record.value ?? null),
    loadFailed: computed(() => stored.value?.loadFailed.value ?? false),
    labels: computed(() => labels.value),
    load: () => stored.value?.load(),
    choose: (place: LaunchPlace) => stored.value?.put('launch', place),
    failure: computed(() => stored.value?.failureOf('launch') ?? ''),
  }
}
