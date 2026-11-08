<script setup lang="ts">
/**
 * A run of a work item's marks, for a surface that holds a few of them: the
 * registry's answer for this item and this surface, drawn by `drawMarks`. A
 * host picks which facets go in this run, and the rest is not its decision: not
 * their order, and not where the item's number stands. Given the number as its
 * slot, the run is the item's head (`drawHead`): the kind, the number, the rest.
 *
 * A run of label chips that must keep one line fits: as many whole chips as
 * the line has room for, then «+N». The room comes from the line's width and
 * the chips' words, worked out without drawing anything to measure, and is
 * handed to the registry, which still says which chips print and what the
 * count says.
 */
import { computed, useSlots, useTemplateRef } from 'vue'

import { drawHead, drawMarks } from '@/entities/work-item/components/drawMarks.ts'
import { useLabelFit } from '@/entities/work-item/composables/useLabelRoom.ts'
import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'
import { FACET_ORDER, leadMarks, surfaceMarks } from '@/entities/work-item/utils/facets.ts'
import type {
  FacetContext,
  FacetId,
  FacetSubject,
  FacetSurface,
} from '@/entities/work-item/utils/facets.ts'
import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

const props = withDefaults(
  defineProps<{
    item: FacetSubject
    surface: FacetSurface
    context?: FacetContext
    /** The facets this run prints, in order; the registry still decides each one. */
    facets?: readonly FacetId[]
    /** The filter in force, so a mark already in it offers to come out. */
    filter?: WorkFilter
    /** Kind, priority and label marks become buttons that filter. */
    filterable?: boolean
    /** Label chips keep one line: the ones with no room fold into «+N». */
    fit?: boolean
    /** The run stays on one line: short of room, a mark shows its glyph alone. */
    fold?: boolean
    /** The glyphs that lead the reference, rather than the facets where the surface says them. */
    lead?: boolean
    /** False inside a container that is one Tab stop. */
    tabbable?: boolean
  }>(),
  {
    facets: () => FACET_ORDER,
    context: () => ({}),
    filter: () => EMPTY_WORK_FILTER,
    filterable: false,
    fold: false,
    fit: false,
    tabbable: true,
    lead: false,
  },
)

const emit = defineEmits<{ filter: [token: WorkFilterToken] }>()
const slots = useSlots()

const words = useMarkWords()

/**
 * Only a run that fits its chips measures its line. Every other run is spared
 * the observer, its watcher and its room; `fit` says which run a host placed
 * where, not a state that changes, so it is read once.
 */
const room = props.fit
  ? useLabelFit(useTemplateRef<HTMLElement>('line'), {
      context: () => props.context,
      enabled: () => props.fit && props.facets.includes('labels'),
      item: () => props.item,
      surface: () => props.surface,
      words,
    })
  : undefined

/** What the registry is asked with: the host's context, and the room the line measured. */
const asked = computed(() =>
  room?.value === undefined ? props.context : { ...props.context, labelRoom: room.value },
)

const marks = computed(() =>
  props.lead
    ? props.facets.flatMap((facet) => leadMarks(facet, props.surface, props.item, asked.value))
    : surfaceMarks(props.surface, props.item, asked.value, props.facets),
)

const draw = () => {
  const run = {
    filter: props.filter,
    filterable: props.filterable,
    fit: props.fit,
    fold: props.fold,
    onFilter: (token: WorkFilterToken) => emit('filter', token),
    surface: props.surface,
    tabbable: props.tabbable,
    words,
  }
  return slots.default ? drawHead(marks.value, run, slots.default()) : drawMarks(marks.value, run)
}
</script>

<template>
  <component
    :is="draw()"
    ref="line"
  />
</template>
