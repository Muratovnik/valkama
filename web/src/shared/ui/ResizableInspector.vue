<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

import {
  clampInspectorWidth,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  inspectorLayoutForWorkspace,
  inspectorWidthFromKey,
  inspectorWidthFromPointer,
  SESSION_INSPECTOR_STORAGE_KEY,
} from '@/shared/lib/shellLayout.ts'

const props = withDefaults(
  defineProps<{
    label: string
    open: boolean
    storageKey?: string
  }>(),
  { storageKey: SESSION_INSPECTOR_STORAGE_KEY },
)

const emit = defineEmits<{ close: [] }>()
const surface = ref<HTMLElement | null>(null)
const preferredWidth = ref(INSPECTOR_DEFAULT_WIDTH)
const workspaceWidth = ref(1440)
const resizing = ref(false)
let startX = 0
let startWidth = INSPECTOR_DEFAULT_WIDTH
const observedWorkspace = ref<HTMLElement | null>(null)

const layout = computed(() => inspectorLayoutForWorkspace(workspaceWidth.value))
const width = computed(() => clampInspectorWidth(preferredWidth.value, workspaceWidth.value))

/** Narrow enough that the inspector sits inside the page instead of over it. */
const contained = computed(() => layout.value.mode === 'contained')
const surfaceStyle = computed(() => ({
  width: contained.value ? 'min(100%, 520px)' : `${width.value}px`,
}))

function storeWidth() {
  if (typeof localStorage !== 'undefined')
    localStorage.setItem(props.storageKey, String(preferredWidth.value))
}

function restoreWidth() {
  if (typeof localStorage === 'undefined') return
  const stored = Number(localStorage.getItem(props.storageKey))
  const requested = Number.isFinite(stored) && stored > 0 ? stored : preferredWidth.value
  preferredWidth.value = Math.min(
    INSPECTOR_MAX_WIDTH,
    Math.max(INSPECTOR_MIN_WIDTH, Math.round(requested)),
  )
}

function measureWorkspace() {
  const element = observedWorkspace.value
  if (!element) return
  workspaceWidth.value = Math.max(0, Math.round(element.getBoundingClientRect().width))
}

function observeWorkspace() {
  observedWorkspace.value = surface.value?.parentElement ?? null
  measureWorkspace()
}

useResizeObserver(observedWorkspace, measureWorkspace)
useEventListener(window, 'resize', measureWorkspace)
useEventListener(window, 'pointermove', (event: PointerEvent) => {
  if (resizing.value) resizeFromPointer(event)
})
useEventListener(window, 'pointerup', () => {
  if (resizing.value) endResize()
})

function beginResize(event: PointerEvent) {
  if (event.button !== 0) return
  event.preventDefault()
  startX = event.clientX
  startWidth = width.value
  resizing.value = true
}

function resizeFromPointer(event: PointerEvent) {
  preferredWidth.value = inspectorWidthFromPointer(
    startWidth,
    startX,
    event.clientX,
    workspaceWidth.value,
  )
}

function endResize() {
  resizing.value = false
  storeWidth()
}

function resizeFromKeyboard(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'End', 'Home'].includes(event.key)) return
  event.preventDefault()
  preferredWidth.value = inspectorWidthFromKey(width.value, event.key, workspaceWidth.value)
  storeWidth()
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      observedWorkspace.value = null
      return
    }
    await nextTick()
    observeWorkspace()
    restoreWidth()
  },
)

watch(
  surface,
  async () => {
    if (!props.open) return
    await nextTick()
    observeWorkspace()
    restoreWidth()
  },
  { immediate: true },
)
</script>

<template>
  <aside
    v-if="open"
    ref="surface"
    class="resizable-inspector"
    :class="{ 'is-resizing': resizing, 'is-contained': contained }"
    :style="surfaceStyle"
    :aria-label="label"
  >
    <!-- The same window-splitter shape as the drawer resizer, and the same rule
      blind spot. -->
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div
      v-if="layout.mode === 'inline'"
      class="inspector-resizer"
      role="separator"
      aria-orientation="vertical"
      tabindex="0"
      :aria-label="label"
      :aria-valuemin="INSPECTOR_MIN_WIDTH"
      :aria-valuemax="layout.maximum"
      :aria-valuenow="width"
      @pointerdown="beginResize"
      @keydown="resizeFromKeyboard"
    >
      <span
        aria-hidden="true"
        class="resizer-grip"
      />
    </div>
    <slot :close="() => emit('close')" />
  </aside>
</template>

<style scoped>
/* The inspector is a floating surface with a width the operator drags, so what
   fits inside it is a question about the inspector. The window cannot answer
   it: the same 1440px screen holds this panel at 320px and at 900px. */
.resizable-inspector {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  max-width: calc(100% - 320px);
  height: 100%;
  min-height: 0;
  color: var(--color-text);
  background: var(--color-surface);
  container: overlay / inline-size;
}

.inspector-resizer {
  position: absolute;
  inset-block: 0;
  left: 0;
  z-index: 10;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 12px;
  transform: translateX(-50%);
  cursor: col-resize;
}

.resizer-grip {
  width: 1px;
  height: 56px;
  background: var(--color-rule-strong);
}

.resizable-inspector.is-resizing,
.resizable-inspector.is-resizing * {
  /* stylelint-disable-next-line declaration-no-important -- during a drag the
     pointer must not pick up the cursor of whatever it passes over */
  cursor: col-resize !important;
  user-select: none;
}

.inspector-resizer:is(:hover, :focus-visible) .resizer-grip {
  width: 2px;
  background: var(--color-accent);
}

.inspector-resizer:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}

.resizable-inspector.is-contained {
  position: absolute;
  inset: 0 0 0 auto;
  z-index: 35;
  max-width: 100%;
  box-shadow: -12px 0 32px var(--color-shadow);
}
</style>
