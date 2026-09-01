<script setup lang="ts">
import { moduleFrameScrollOwner } from '@/widgets/module-frame/utils/moduleFrame'
import type { ModuleFrameModule } from '@/widgets/module-frame/utils/moduleFrame'

const props = defineProps<{ label: string; module: ModuleFrameModule }>()
</script>

<template>
  <main
    class="module-frame"
    tabindex="-1"
    :aria-label="props.label"
    :data-scroll-owner="moduleFrameScrollOwner(props.module)"
  >
    <div
      class="module-frame-content"
      :class="[`module-${props.module}`]"
    >
      <slot />
    </div>
  </main>
</template>

<style scoped>
.module-frame {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-canvas);
  overflow-y: auto;
  overscroll-behavior: contain;
}

/* The frame around it already paints the workspace; a second copy of the same
   value on the centered column only made the two harder to keep equal. */
.module-frame-content {
  position: relative;
  width: min(var(--size-module-column), 100%);
  min-height: 100%;
  padding: var(--space-6) var(--size-page-gutter) var(--space-12);
  margin: 0 auto;

  &.module-sessions {
    width: 100%;
    height: 100%;
    padding: 0;
  }
}

@container workspace (width <= 696px) {
  .module-frame-content {
    padding-bottom: var(--space-24);
  }
}
</style>
