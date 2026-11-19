<script setup lang="ts">
/**
 * A card's own controls in its bar, before Close: Back, where this card was opened from
 * another, and «…», where the item is read and in the primary store: what else can be done to it,
 * pin it or change what it is part of (`InspectorMenu`).
 */
import InspectorBack from '@/widgets/work-item-inspector/components/InspectorBack.vue'
import InspectorMenu from '@/widgets/work-item-inspector/components/InspectorMenu.vue'

defineProps<{
  /** There is a card to go back to. */
  back: boolean
  /** The item is read and in the primary store, whose items a person can pin. */
  menu: boolean
  reference: string
}>()
const emit = defineEmits<{ back: [] }>()
</script>

<template>
  <InspectorBack
    v-if="back"
    @back="emit('back')"
  />
  <InspectorMenu
    v-if="menu"
    :reference="reference"
  />
</template>
