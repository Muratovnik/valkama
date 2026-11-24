<script setup lang="ts">
/**
 * The registered projects that are in no space, in one quiet line under every space's card,
 * and where they are added. Nothing is drawn while there are none, or while the registry
 * could not be read: a line that says nothing for certain would only be a guess.
 *
 * It reads the registry when it is drawn, and again after each save of the space window.
 * The line is `data-part="unplaced"`.
 */
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpaceWindow } from '@/features/space-window/spaceWindowHost.ts'

import { fetchRegisteredProjects } from '@/shared/api/spaceWindowApi.ts'
import type { RegisteredProject } from '@/shared/api/spaceWindowApi.ts'

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
const hinted = computed(() => opener?.creatable() ?? false)
const names = computed(() => unplaced.value.map((project) => project.display_name).join(', '))
</script>

<template>
  <p
    v-if="unplaced.length"
    class="unplaced"
    data-part="unplaced"
  >
    {{ t('spaceWindow.unplaced') }} <strong class="unplaced-names">{{ names }}</strong
    ><template v-if="hinted"> — {{ t('spaceWindow.unplacedHint') }}</template>
  </p>
</template>

<style scoped>
.unplaced {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.unplaced-names {
  color: var(--color-text);
  font-weight: 600;
}
</style>
