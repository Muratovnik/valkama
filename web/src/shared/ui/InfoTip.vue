<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'

import { useEventListener } from '@vueuse/core'

import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{
    /**
     * What the control is called: the default trigger's name, and the name of the
     * panel when it is a dialog.
     */
    label: string
    /**
     * Whether the control opens the panel now. Where it does not, the consumer
     * presses the control for its own action, and the control is no popup.
     */
    active?: boolean
    /**
     * The panel holds a control. It is then a dialog that takes focus when it
     * opens and gives focus back to its control on Escape, not a tooltip that
     * only reads.
     */
    interactive?: boolean
  }>(),
  { active: true, interactive: false },
)

const panelId = useId()
const isOpen = ref(false)
/**
 * The popup state of the control, given only while it opens the panel: an
 * absent attribute is `undefined`, so a control that does not open is no popup.
 */
const popup = computed(() =>
  props.active
    ? { controls: panelId, expanded: isOpen.value }
    : { controls: undefined, expanded: undefined },
)
const panelRole = computed(() => (props.interactive ? 'dialog' : 'tooltip'))
const panelName = computed(() => (props.interactive ? props.label : undefined))
/** The control that opened the panel; focus returns to it. */
const anchor = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

/** Opens the panel from the control that asked, or closes it when it is open. */
function toggle(event?: Event) {
  if (isOpen.value) {
    close()
    return
  }
  anchor.value =
    (event?.currentTarget as HTMLElement | null | undefined) ??
    (document.activeElement as HTMLElement | null)
  isOpen.value = true
}

/** Closes the panel; focus goes back to the control that opened it when asked. */
function close(restoreFocus = false) {
  isOpen.value = false
  if (restoreFocus) anchor.value?.focus()
}

/**
 * Escape closes an open panel and returns focus to the control that opened it. A closed one
 * lets the key go on to the dialog or panel around it.
 */
function dismiss(event: KeyboardEvent) {
  if (!isOpen.value) return
  event.stopPropagation()
  close(true)
}

/** Focus leaving both the control and its panel closes the panel. */
function closeWhenFocusLeaves(event: FocusEvent) {
  const next = event.relatedTarget
  if (next instanceof Node && (root.value?.contains(next) || panel.value?.contains(next))) return
  close()
}

function updatePosition() {
  if (!anchor.value || !panel.value) return
  const trigger = anchor.value.getBoundingClientRect()
  const tooltip = panel.value.getBoundingClientRect()
  const gap = 8
  const gutter = 12
  const left = Math.min(
    window.innerWidth - tooltip.width - gutter,
    Math.max(gutter, trigger.left + trigger.width / 2 - tooltip.width / 2),
  )
  const above = trigger.top - tooltip.height - gap
  const top =
    above >= gutter
      ? above
      : Math.min(window.innerHeight - tooltip.height - gutter, trigger.bottom + gap)
  panelStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(Math.max(gutter, top))}px`,
  }
}

watch(isOpen, async (open) => {
  if (!open) return
  await nextTick()
  updatePosition()
  // A dialog's first control takes focus, so the keyboard reaches it at once; a tooltip never takes focus.
  if (props.interactive) panel.value?.querySelector('button')?.focus()
})

useEventListener(window, 'resize', updatePosition)
useEventListener(window, 'scroll', updatePosition, true)

defineExpose({ close })
</script>

<template>
  <!-- A wrapper watching focus leave its subtree and Escape leave the control or -->
  <!-- its panel. The panel is teleported, so it watches its own focus and keys. -->
  <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
  <span
    ref="root"
    class="info-tip"
    @focusout="closeWhenFocusLeaves"
    @keydown.esc="dismiss"
  >
    <slot
      name="trigger"
      :toggle="toggle"
      :popup="popup"
    >
      <button
        type="button"
        class="info-tip-trigger"
        :aria-label="props.label"
        :aria-controls="popup.controls"
        :aria-expanded="popup.expanded"
        @click="toggle"
      >
        <VIcon
          name="info"
          :size="18"
        />
      </button>
    </slot>
    <Teleport to="body">
      <!-- The panel's role is its kind: a dialog holds a control, a tooltip reads. -->
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
      <div
        v-if="isOpen"
        :id="panelId"
        ref="panel"
        class="info-tip-panel"
        :role="panelRole"
        :aria-label="panelName"
        :style="panelStyle"
        @focusout="closeWhenFocusLeaves"
        @keydown.esc="dismiss"
      >
        <slot />
      </div>
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
