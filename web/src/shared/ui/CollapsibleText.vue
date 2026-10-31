<script setup lang="ts">
/**
 * Text that may run long, shown to a few lines until the reader asks for the rest.
 *
 * Agents write descriptions and comments a screen long, and the inspector used
 * to print every one of them in full: one item read as a ribbon nearly ten
 * thousand pixels tall, with the comment field at its far end. The whole text
 * stays in the document, so search and a screen reader still reach it; only
 * its height is held until the toggle is pressed. The toggle appears only when
 * something is actually hidden.
 *
 * The host sets the type on this component's root, the way it would on the
 * paragraph this replaces.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useResizeObserver } from '@vueuse/core'

import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(defineProps<{ text: string; lines?: number }>(), { lines: 8 })

const { t } = useI18n()
const expanded = ref(false)
const overflowing = ref(false)
const body = ref<HTMLElement | null>(null)

function measure() {
  const element = body.value
  if (!element || expanded.value) return
  overflowing.value = element.scrollHeight > element.clientHeight + 1
}

useResizeObserver(body, measure)
onMounted(measure)
watch(
  () => props.text,
  () => {
    expanded.value = false
    void nextTick(measure)
  },
)
const toggleLabel = computed(() =>
  t(expanded.value ? 'platform.actions.collapse' : 'platform.actions.expand'),
)
</script>

<template>
  <div class="collapsible">
    <p
      ref="body"
      class="collapsible-text"
      :class="{ clamped: !expanded }"
      :style="{ '--collapsible-lines': props.lines }"
    >
      {{ props.text }}
    </p>
    <VButton
      v-if="overflowing"
      class="collapsible-toggle"
      size="inline"
      variant="ghost"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
      >{{ toggleLabel }}</VButton
    >
  </div>
</template>

<style scoped>
.collapsible {
  /* The host's line count arrives inline; this is the fallback. */
  --collapsible-lines: 8;

  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.collapsible-text {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;

  &.clamped {
    max-height: calc(var(--collapsible-lines) * 1lh);
    overflow: hidden;
  }
}

/* The toggle starts where the text starts, so it reads as the text's own end
   rather than as an action of the section around it. */
.collapsible-toggle {
  justify-self: start;
  margin-inline-start: calc(-1 * var(--space-2));
}
</style>
