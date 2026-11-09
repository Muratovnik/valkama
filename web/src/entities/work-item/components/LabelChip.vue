<script setup lang="ts">
/**
 * One label as a chip, wherever a label stands alone: `drawChip` says how it looks. Its words
 * stand in the middle of its face: it ends in nothing, since a label is taken off an item in
 * the picker that attaches it (`WorkItemLabels`), not by a × kept at the chip's end.
 */
import { drawChip } from '@/entities/work-item/components/drawMarks.ts'
import { useMarkWords } from '@/entities/work-item/composables/useMarkWords.ts'

const props = withDefaults(
  defineProps<{
    label: string
    /** The label is in the filter now. */
    active?: boolean
    /** A button that filters; otherwise a plain chip. */
    filterable?: boolean
    tabbable?: boolean
  }>(),
  { active: false, filterable: true, tabbable: true },
)

const emit = defineEmits<{ filter: [label: string] }>()

const words = useMarkWords()

const chip = () =>
  drawChip({
    active: props.active,
    filterable: props.filterable,
    label: props.label,
    onFilter: (label) => emit('filter', label),
    tabbable: props.tabbable,
    words,
  })
</script>

<template>
  <component :is="chip()" />
</template>
