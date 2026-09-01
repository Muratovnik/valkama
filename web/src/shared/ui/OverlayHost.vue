<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'

import { useEventListener } from '@vueuse/core'

import {
  DRAWER_DEFAULT_WIDTH,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
  DRAWER_NARROW_BREAKPOINT,
  DRAWER_VIEWPORT_GUTTER,
  INSPECTOR_DRAWER_STORAGE_KEY,
  INSPECTOR_KEYBOARD_STEP,
} from '@/shared/lib/shellLayout.ts'
import {
  claimOverlayOwnership,
  ownsOverlay,
  releaseOverlayOwnership,
} from '@/shared/ui/overlayStack.ts'
import type { OverlayOwnership } from '@/shared/ui/overlayStack.ts'

const props = withDefaults(
  defineProps<{
    open: boolean
    ariaLabel?: string
    drawerDefaultWidth?: number
    drawerMaxWidth?: number
    drawerMinWidth?: number
    interactive?: boolean
    layer?: 'drawer' | 'command'
    resizable?: boolean
    resizeLabel?: string
    surfaceClass?: string
    title?: string
    variant?: 'dialog' | 'drawer'
    widthStorageKey?: string
  }>(),
  {
    title: '',
    ariaLabel: '',
    variant: 'dialog',
    surfaceClass: '',
    resizable: false,
    resizeLabel: '',
    widthStorageKey: INSPECTOR_DRAWER_STORAGE_KEY,
    drawerDefaultWidth: DRAWER_DEFAULT_WIDTH,
    drawerMinWidth: DRAWER_MIN_WIDTH,
    drawerMaxWidth: DRAWER_MAX_WIDTH,
    interactive: true,
    layer: 'command',
  },
)

const emit = defineEmits<{ close: [] }>()
const surface = ref<HTMLElement | null>(null)
const titleId = `overlay-title-${useId()}`
let ownership: OverlayOwnership | null = null
const preferredDrawerWidth = ref(props.drawerDefaultWidth)
const viewportWidth = ref(typeof window === 'undefined' ? 1440 : window.innerWidth)
const resizing = ref(false)
let resizeStartX = 0
let resizeStartWidth = props.drawerDefaultWidth

const isResizableDrawer = computed(() => props.resizable && props.variant === 'drawer')
const drawerMaximum = computed(() =>
  viewportWidth.value <= DRAWER_NARROW_BREAKPOINT
    ? viewportWidth.value
    : Math.min(props.drawerMaxWidth, viewportWidth.value - DRAWER_VIEWPORT_GUTTER),
)
const drawerMinimum = computed(() => Math.min(props.drawerMinWidth, drawerMaximum.value))
const drawerWidth = computed(() =>
  Math.min(
    drawerMaximum.value,
    Math.max(drawerMinimum.value, Math.round(preferredDrawerWidth.value)),
  ),
)
const surfaceStyle = computed(() =>
  isResizableDrawer.value
    ? {
        width: viewportWidth.value <= DRAWER_NARROW_BREAKPOINT ? '100vw' : `${drawerWidth.value}px`,
      }
    : undefined,
)

/**
 * Whether this overlay takes input, as the five attributes that say so.
 *
 * A passive overlay is a preview of a surface rather than the surface: it is on
 * screen, it is inert, and it is hidden from the accessibility tree, so nothing
 * inside it can be reached or named. The five travel together because they
 * describe one fact and cannot be allowed to disagree, and each is absent in the
 * case it does not apply — `aria-hidden="false"` is a claim, not a default.
 */
const modality = computed(() =>
  props.interactive
    ? ({
        'role': 'dialog',
        'aria-modal': 'true',
        'aria-label': props.ariaLabel || undefined,
        'aria-labelledby': props.title ? titleId : undefined,
      } as const)
    : ({ 'aria-hidden': true, 'inert': true } as const),
)

/** Escape closes an overlay that takes input, and does nothing to one that does not. */
function closeOnEscape() {
  if (props.interactive) emit('close')
}

function focusable(): HTMLElement[] {
  if (!surface.value) return []
  return Array.from(
    surface.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((item) => !item.hasAttribute('aria-hidden'))
}

async function focusSurface() {
  await nextTick()
  if (!ownsOverlay(ownership)) return
  const controls = focusable()
  const preferred = controls.find((control) => !Object.hasOwn(control.dataset, 'overlayResizer'))
  preferred?.focus()
  if (!preferred) surface.value?.focus()
}

function measureViewport() {
  viewportWidth.value = window.innerWidth
}

function restoreDrawerWidth() {
  if (!isResizableDrawer.value || typeof localStorage === 'undefined') return
  const stored = Number(localStorage.getItem(props.widthStorageKey))
  const requested = Number.isFinite(stored) && stored > 0 ? stored : props.drawerDefaultWidth
  preferredDrawerWidth.value = Math.round(requested)
}

function storeDrawerWidth() {
  if (!isResizableDrawer.value || typeof localStorage === 'undefined') return
  localStorage.setItem(props.widthStorageKey, String(preferredDrawerWidth.value))
}

function beginResize(event: PointerEvent) {
  if (!isResizableDrawer.value || event.button !== 0) return
  event.preventDefault()
  resizeStartX = event.clientX
  resizeStartWidth = drawerWidth.value
  resizing.value = true
}

function resizeFromPointer(event: PointerEvent) {
  preferredDrawerWidth.value = Math.min(
    drawerMaximum.value,
    Math.max(drawerMinimum.value, resizeStartWidth + resizeStartX - event.clientX),
  )
}

function endResize() {
  resizing.value = false
  storeDrawerWidth()
}

useEventListener(window, 'resize', measureViewport)
useEventListener(window, 'pointermove', (event: PointerEvent) => {
  if (resizing.value) resizeFromPointer(event)
})
useEventListener(window, 'pointerup', () => {
  if (resizing.value) endResize()
})

function resizeFromKeyboard(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'End', 'Home'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') preferredDrawerWidth.value = drawerMinimum.value
  if (event.key === 'End') preferredDrawerWidth.value = drawerMaximum.value
  if (event.key === 'ArrowLeft')
    preferredDrawerWidth.value = Math.min(
      drawerMaximum.value,
      drawerWidth.value + INSPECTOR_KEYBOARD_STEP,
    )
  if (event.key === 'ArrowRight')
    preferredDrawerWidth.value = Math.max(
      drawerMinimum.value,
      drawerWidth.value - INSPECTOR_KEYBOARD_STEP,
    )
  storeDrawerWidth()
}

function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !ownsOverlay(ownership)) return
  const controls = focusable()
  const first = controls[0]
  const last = controls.at(-1)
  // Nothing to trap between when the surface holds no focusable control, and
  // asking for both ends is the same check the length test was standing in for.
  if (!first || !last) return
  const active = document.activeElement
  if (event.shiftKey && (active === first || !surface.value?.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !surface.value?.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

function release() {
  if (!ownership) return
  releaseOverlayOwnership(ownership)
  ownership = null
}

watch(
  [() => props.open, () => props.interactive],
  async ([open, interactive]) => {
    if (open && interactive) {
      // Only the top surface claims focus and scroll. A mounted drawer can remain
      // visible under a command dialog without becoming a second dialog owner.
      ownership = claimOverlayOwnership()
      measureViewport()
      restoreDrawerWidth()
      await focusSurface()
    } else {
      release()
    }
  },
  { immediate: true, flush: 'post' },
)

onUnmounted(release)
</script>

<template>
  <Teleport to="body">
    <!-- The six-class enter/leave pattern, on the one component that owns every
         overlay surface. A drawer and a dialog arrived by appearing, which
         reads as a jump cut: the operator has to work out what changed. There
         is no separate wrapper component for this because there is exactly one
         consumer, and a reusable transition with one consumer is ceremony. -->
    <Transition
      name="overlay"
      appear
    >
      <!-- Escape on the overlay root, which is how a dialog closes from anywhere -->
      <!-- inside it. The focusable surface is the section below. -->
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
      <div
        v-if="open"
        class="overlay-host"
        :class="[`overlay-${variant}`, `overlay-layer-${layer}`, { 'is-passive': !interactive }]"
        @keydown.esc.prevent="closeOnEscape"
      >
        <!-- The scrim is a pointer affordance by definition: clicking outside a dialog -->
        <!-- dismisses it. The keyboard equivalent is Escape, handled one level up. -->
        <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
        <div
          v-if="interactive"
          class="overlay-scrim"
          @click="emit('close')"
        />
        <!-- The role is inside `modality`, which the a11y rule cannot look into: it
             reads the attributes written on the element and this one carries a
             computed object. An interactive surface here is `role="dialog"` with a
             name and `aria-modal`, and a passive one is `inert` and hidden, so the
             handler below never reaches a plain `section`. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <section
          ref="surface"
          class="overlay-surface"
          tabindex="-1"
          :class="[`overlay-surface-${variant}`, surfaceClass, { 'is-resizing': resizing }]"
          :style="surfaceStyle"
          v-bind="modality"
          @keydown="trapFocus"
        >
          <!-- A window splitter, built the way ARIA asks: role, orientation, value -->
          <!-- range, tabindex and its own key handler. The rule does not count -->
          <!-- separator among the interactive roles. -->
          <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
          <div
            v-if="isResizableDrawer && viewportWidth > DRAWER_NARROW_BREAKPOINT"
            class="overlay-resizer"
            role="separator"
            aria-orientation="vertical"
            tabindex="0"
            :aria-label="resizeLabel || ariaLabel"
            :aria-valuemin="drawerMinimum"
            :aria-valuemax="drawerMaximum"
            :aria-valuenow="drawerWidth"
            data-overlay-resizer
            @pointerdown="beginResize"
            @keydown="resizeFromKeyboard"
          >
            <span aria-hidden="true" />
          </div>
          <span
            v-if="title"
            :id="titleId"
            class="visually-hidden"
            >{{ title }}</span
          >
          <slot />
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay-host {
  position: fixed;
  inset: 0;
}

.overlay-layer-drawer {
  z-index: 90;
}

.overlay-layer-command {
  z-index: 100;
}

/* The scrim is what makes a surface modal: the window behind it has to read as
   out of reach, not merely tinted. At 42% of a near-black it dimmed the canvas
   by about a step of the grey ramp, which is the distance between two ordinary
   surfaces — so a dialog looked like one more panel. */
.overlay-scrim {
  position: absolute;
  inset: 0;
  background: var(--color-overlay-scrim);
}

/* The scrim fades; the surface arrives under its own power. A drawer comes in
   from the edge it is attached to, and a dialog steps up from just below,
   because a dialog that scales up from nothing reads as an alert. Both leave
   the way they came, which is what tells the operator the surface went back
   where it was rather than being destroyed. */
:is(.overlay-enter-active, .overlay-leave-active) .overlay-scrim {
  transition: opacity var(--duration-surface) var(--ease-out);
}

:is(.overlay-enter-from, .overlay-leave-to) .overlay-scrim {
  opacity: 0;
}

:is(.overlay-enter-active, .overlay-leave-active) .overlay-surface-drawer {
  transition: transform var(--duration-surface) var(--ease-out);
}

:is(.overlay-enter-from, .overlay-leave-to) .overlay-surface-drawer {
  transform: translateX(100%);
}

:is(.overlay-enter-active, .overlay-leave-active) .overlay-surface-dialog {
  transition:
    opacity var(--duration-surface) var(--ease-out),
    transform var(--duration-surface) var(--ease-out);
}

:is(.overlay-enter-from, .overlay-leave-to) .overlay-surface-dialog {
  opacity: 0;
  transform: translateY(var(--space-2));
}

.overlay-surface {
  position: relative;
  z-index: 1;
  max-height: 100dvh;
  outline: none;
}

.overlay-dialog {
  display: grid;
  place-items: center;
  padding: var(--space-5);
}

/* Both surfaces are their own measure. A dialog stops growing at 640px however
   wide the monitor gets, so what its fields can afford is a question about the
   dialog; the window kept answering a different one. */
.overlay-surface-dialog {
  width: min(640px, calc(100vw - 40px));
  max-height: calc(100dvh - 40px);
  overflow-y: auto;
  container: overlay / inline-size;
}

.overlay-surface-drawer {
  /* The drawer is its own ground, so a sheet inside it starts from the drawer
     rather than from the muted ground it would inherit. Every other step of
     the ladder holds here, and restating those was how nine lines said what
     one does. */
  --color-surface-sheet: var(--color-surface);

  position: absolute;
  inset: 0 0 0 auto;
  display: flex;
  flex-direction: column;
  width: min(700px, 96vw);
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  background: var(--color-surface);
  overflow-y: auto;
  overscroll-behavior: contain;
  box-shadow: var(--shadow-overlay);
  container: overlay / inline-size;

  &.is-resizing,
  &.is-resizing * {
    /* stylelint-disable-next-line declaration-no-important -- during a drag the
     pointer must not pick up the cursor of whatever it passes over */
    cursor: col-resize !important;
    user-select: none;
  }
}

.overlay-resizer {
  position: absolute;
  inset: 0 auto 0 -6px;
  z-index: 4;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 12px;
  cursor: col-resize;
}

.overlay-resizer-grip {
  width: 1px;
  height: 56px;
  background: var(--color-rule-strong);

  .overlay-resizer:is(:hover, :focus-visible) & {
    width: 2px;
    background: var(--color-focus-ring);
  }
}

.overlay-resizer:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: -2px;
}

/* The one viewport question left in the overlay: how wide the drawer itself
   should be. A container cannot answer that without asking itself. */
@media (width <= 620px) {
  .overlay-surface-drawer {
    width: 100vw;
    box-shadow: none;
  }
}
</style>
