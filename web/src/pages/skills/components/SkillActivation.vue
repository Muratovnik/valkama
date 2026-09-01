<script setup lang="ts">
/**
 * Which clients a skill is switched on for, and the switch for each.
 *
 * Every row owns its own write, so what is left here is the list, the heading
 * the drawer puts above it, and the one fact that cannot belong to a row: the
 * server answers a write with the whole inventory, and `updated` carries that
 * up past this section to whoever holds the catalogue.
 */
import SkillClientRow from '@/pages/skills/components/SkillClientRow.vue'

import type { SkillClient, SkillEntry, SkillsPayload } from '@/shared/types/skills.ts'

const props = defineProps<{ clients: SkillsPayload['clients']; skill: SkillEntry }>()
const emit = defineEmits<{ updated: [payload: SkillsPayload] }>()

/**
 * A row's identity, which names the skill as well as the client.
 *
 * The drawer keeps this component while the reader moves down the catalogue, so
 * a row keyed by client alone would be reused for the next skill and show it a
 * spinner belonging to a write that was never about it.
 */
function rowKey(client: SkillClient) {
  return `${props.skill.key}:${client}`
}
</script>

<template>
  <section>
    <slot />
    <div class="client-activation-list">
      <SkillClientRow
        v-for="client in props.clients"
        :key="rowKey(client.id)"
        :client="client.id"
        :skill="props.skill"
        @updated="emit('updated', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
/* Each client is its own block on its own ground, so what separates two of them
   is the panel showing through between. A hairline between two blocks that
   already have a ground is the third way of saying it. */
.client-activation-list {
  display: grid;
  gap: var(--space-1);
}
</style>
