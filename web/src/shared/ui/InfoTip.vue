<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue'

import { useEventListener } from '@vueuse/core'

import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** Localized label announcing the topic before the help text. */
  label: string
}>()

const panelId = useId()
const isOpen = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

function toggle() {
  isOpen.value = !isOpen.value
}

function close() {
  isOpen.value = false
}

function closeWhenFocusLeaves(event: FocusEvent) {
  const root = event.currentTarget as HTMLElement
  if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) close()
}

function updatePosition() {
  if (!trigger.value || !panel.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const tooltip = panel.value.getBoundingClientRect()
  const gap = 8
  const gutter = 12
  const left = Math.min(
    window.innerWidth - tooltip.width - gutter,
    Math.max(gutter, anchor.left + anchor.width / 2 - tooltip.width / 2),
  )
  const above = anchor.top - tooltip.height - gap
  const top =
    above >= gutter
      ? above
      : Math.min(window.innerHeight - tooltip.height - gutter, anchor.bottom + gap)
  panelStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(Math.max(gutter, top))}px`,
  }
}

watch(isOpen, async (open) => {
  if (!open) return
  await nextTick()
  updatePosition()
})

useEventListener(window, 'resize', updatePosition)
useEventListener(window, 'scroll', updatePosition, true)
</script>

<template>
  <!-- A wrapper watching focus leave its subtree and Escape leave the panel. The -->
  <!-- control is the button inside it; this element is never the target. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <span
    class="info-tip"
    @focusout="closeWhenFocusLeaves"
    @keydown.esc.stop="close"
  >
    <button
      ref="trigger"
      type="button"
      class="info-tip-trigger"
      :aria-label="props.label"
      :aria-controls="panelId"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <VIcon
        name="info"
        :size="18"
      />
    </button>
    <Teleport to="body">
      <span
        v-if="isOpen"
        :id="panelId"
        ref="panel"
        class="info-tip-panel"
        role="tooltip"
        :style="panelStyle"
        ><slot
      /></span>
    </Teleport>
  </span>
</template>

<style scoped>
.info-tip {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
}

.info-tip-trigger {
  display: inline-grid;
  place-items: center;
  inline-size: var(--size-control-target, 44px);
  min-inline-size: var(--size-control-target, 44px);
  block-size: var(--size-control-target, 44px);
  min-block-size: var(--size-control-target, 44px);
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
    background: var(--color-surface-hover);
  }
}

.info-tip-panel {
  position: fixed;
  z-index: 120;
  inline-size: min(20rem, calc(100vw - 2rem));
  padding: var(--space-3);
  border: 1px solid var(--color-tooltip-border);
  color: var(--color-tooltip-text);
  font: var(--font-note);
  text-align: start;
  background: var(--color-tooltip-surface);
  border-radius: var(--radius-control);
  box-shadow: 0 12px 28px var(--color-shadow);
}
</style>
