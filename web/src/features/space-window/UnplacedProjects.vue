<script setup lang="ts">
/**
 * The registered projects that are in no space, in one quiet line under every space's card or
 * under the empty state's «Create a space», and where they are added. Nothing is drawn while
 * there are none, or while the registry could not be read: a line that says nothing for certain
 * would only be a guess.
 *
 * Each name keeps to one line while the line has room for it, and moves to the next whole: run
 * on as one text, a name broke between two lines and read as two. The line stands further from
 * the cards than they stand from each other, so it does not read as one more of them.
 *
 * It reads the registry when it is drawn, and again after each save of the space window.
 * The line is `data-part="unplaced"`.
 */
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpaceWindow } from '@/features/space-window/spaceWindowHost.ts'

import { fetchRegisteredProjects } from '@/shared/api/spaceWindowApi.ts'
import type { RegisteredProject } from '@/shared/api/spaceWindowApi.ts'

const props = withDefaults(
  defineProps<{
    /** Says where they are added, «Configure space»: false where no space stands to configure. */
    hint?: boolean
  }>(),
  { hint: true },
)
const { t } = useI18n()
const opener = useSpaceWindow()
const unplaced = shallowRef<RegisteredProject[]>([])
let reading = 0

async function read() {
  const current = ++reading
  try {
    const answer = await fetchRegisteredProjects()
    if (current !== reading) return
    const known = ['absent', 'available'].includes(answer.registry.status)
    unplaced.value = known ? answer.projects.filter((project) => project.space === null) : []
  } catch {
    if (current === reading) unplaced.value = []
  }
}

onMounted(read)
watch(() => opener?.saves.value, read)

/** Where they are added is said only where a space can be configured here. */
const hinted = computed(() => props.hint && (opener?.creatable() ?? false))
/**
 * Each name as the line shows it, with the comma after it but the last's inside its own box, and
 * the space after that comma outside it, as a gap the line can break at: a space ending the box
 * is dropped at its end, and the names ran together; written in the template between the boxes,
 * it is a whitespace the template drops.
 */
const names = computed(() =>
  unplaced.value.map((project, index) => {
    const more = index < unplaced.value.length - 1
    return {
      id: project.project_id,
      words: more ? `${project.display_name},` : project.display_name,
      gap: more ? ' ' : '',
    }
  }),
)
</script>

<template>
  <p
    v-if="unplaced.length"
    class="unplaced"
    data-part="unplaced"
  >
    {{ t('spaceWindow.unplaced') }}
    <template
      v-for="name in names"
      :key="name.id"
      ><strong class="unplaced-name">{{ name.words }}</strong
      >{{ name.gap }}</template
    ><template v-if="hinted"> — {{ t('spaceWindow.unplacedHint') }}</template>
  </p>
</template>

<style scoped>
.unplaced {
  margin: var(--space-4) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

/* A name wraps inside only where it is longer than the whole line. */
.unplaced-name {
  display: inline-block;
  max-width: 100%;
  color: var(--color-text);
  font-weight: 600;
}
</style>
