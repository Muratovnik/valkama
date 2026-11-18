<script setup lang="ts">
/**
 * A work item's title as it was written, with each reference in it kept from breaking at its
 * hyphen and the rest free to break after a `/` as well. The card's head and the hover card
 * (`WorkItemPreview`) draw it inside a line of their own, which sets its font and how it wraps.
 */
import { computed } from 'vue'

import { titleRuns } from '@/entities/work-item/utils/titleRuns.ts'

import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'

const props = defineProps<{ title: string }>()
const runs = computed(() => titleRuns(props.title))
</script>

<template>
  <template
    v-for="(run, index) in runs"
    :key="index"
  >
    <span
      v-if="run.whole"
      class="title-reference"
      >{{ run.text }}</span
    ><span
      v-else
      v-slash-breaks="run.text"
    />
  </template>
</template>

<style scoped>
/* A reference in the title is one word: a line breaks around it, never at its hyphen. */
.title-reference {
  white-space: nowrap;
}
</style>
