<script setup lang="ts">
/**
 * A panel over the page from the rail's edge, for what the rail has no room to show on
 * a phone. It is the rail's own ground, so what it holds reads as the rail opened wider,
 * and it is a dialog as every overlay is: focus goes in and is held there, and the
 * cross, the scrim and Escape close it and give focus back to what opened it.
 *
 * Its head is the rail's head and not an overlay's: the title at the rail's size beside
 * the way out, and no rule under them, since the rail draws none. An overlay's head stands
 * 24px in from its edges, which on a panel 340px wide is room the rows need. The title
 * starts where the words of what the panel holds start, which only the content knows: it
 * says how far in from the body's edge they stand as `titleIndent`.
 */
import { computed, useId } from 'vue'

import OverlayHost from '@/shared/ui/OverlayHost.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  closeLabel: string
  open: boolean
  title: string
  /** How far the content's words stand in from the body's edge, as a CSS length. */
  titleIndent?: string
}>()

const emit = defineEmits<{ close: [] }>()
const titleId = `side-panel-${useId()}`
const indent = computed(() =>
  props.titleIndent === undefined ? undefined : { '--side-panel-indent': props.titleIndent },
)
</script>

<template>
  <OverlayHost
    variant="drawer"
    edge="start"
    layer="command"
    :open="open"
    :aria-label="title"
    @close="emit('close')"
  >
    <section
      class="side-panel"
      :style="indent"
      :aria-labelledby="titleId"
    >
      <header class="side-panel-head">
        <h2
          :id="titleId"
          v-tooltip.clipped="title"
          class="side-panel-title one-line"
        >
          {{ title }}
        </h2>
        <VButton
          v-tooltip.name="closeLabel"
          class="side-panel-close"
          variant="ghost"
          :aria-label="closeLabel"
          icon
          @click="emit('close')"
        >
          <VIcon name="close" />
        </VButton>
      </header>
      <div class="side-panel-body">
        <slot />
      </div>
    </section>
  </OverlayHost>
</template>

<style scoped>
/* The title starts at the body's edge, 8px, and the content's indent past it, which the
   content's `titleIndent` sets on this element in place of the 8px it otherwise takes. */
.side-panel {
  --side-panel-indent: var(--space-2);
  --side-panel-title-start: calc(var(--space-2) + var(--side-panel-indent));

  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  color: var(--color-text-on-dark);
  background: var(--color-navigation);
}

.side-panel-head {
  display: flex;
  flex: none;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
  padding: var(--space-2) var(--space-2) var(--space-2) calc(var(--side-panel-title-start));
}

.side-panel-title {
  margin: 0;
  font-size: var(--font-size-module);
  font-weight: 700;
  letter-spacing: -0.02em;
}

/* A finger's target: there is no label to widen it. */
.side-panel-close {
  min-inline-size: var(--size-control-target);
  min-block-size: var(--size-control-target);
}

/* Its own scroller, so the head and its way out stay where the thumb left them. */
.side-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 var(--space-2) var(--space-4);
  overflow-y: auto;
  overscroll-behavior: contain;
}
</style>
