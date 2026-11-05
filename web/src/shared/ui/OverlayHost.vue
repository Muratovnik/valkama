<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, useId, watch } from 'vue'

import {
  DRAWER_DEFAULT_WIDTH,
  DRAWER_MAX_WIDTH,
  DRAWER_MIN_WIDTH,
  DRAWER_NARROW_BREAKPOINT,
  INSPECTOR_DRAWER_STORAGE_KEY,
} from '@/shared/lib/shellLayout.ts'
import OverlayPane from '@/shared/ui/OverlayPane.vue'
import { usePaneFit, usePaneWalk, useSurfaceGlide } from '@/shared/ui/overlayPanes.ts'
import type { OverlayPaneNames, PaneFit } from '@/shared/ui/overlayPanes.ts'
import OverlayResizer from '@/shared/ui/OverlayResizer.vue'
import {
  claimOverlayOwnership,
  ownsOverlay,
  releaseOverlayOwnership,
} from '@/shared/ui/overlayStack.ts'
import type { OverlayOwnership } from '@/shared/ui/overlayStack.ts'
import { isStrayPress, outOfReach } from '@/shared/ui/strayPress.ts'
import { useDrawerWidth } from '@/shared/ui/useDrawerWidth.ts'
import { useOverlayFocus } from '@/shared/ui/useOverlayFocus.ts'

const props = withDefaults(
  defineProps<{
    open: boolean
    ariaLabel?: string
    /**
     * What the surface holds, for one that outlives its content: when this changes
     * focus has gone with the old content, and moves in again as it does on an open.
     */
    contentKey?: string
    drawerDefaultWidth?: number
    drawerMaxWidth?: number
    drawerMinWidth?: number
    interactive?: boolean
    layer?: 'drawer' | 'command'
    /** A second pane in this surface, beside what it holds, while there is one to show. */
    pane?: OverlayPaneNames | null
    /**
     * How much of the window stays clear beside this surface and a pane. Given, the surface
     * says whether a pane would fit (`paneFit`); absent, it never holds one.
     */
    paneRoom?: number
    /**
     * Where a dialog stands. One whose height follows what is typed into it
     * stands near the top: centred, its search field moved up and down the
     * window with every result that arrived or left.
     */
    placement?: 'center' | 'top'
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

const emit = defineEmits<{
  'close': []
  'pane-close': []
  'pane-fit': [fit: PaneFit | null]
}>()
const surface = ref<HTMLElement | null>(null)
const titleId = `overlay-title-${useId()}`
const mainNameId = `overlay-main-${useId()}`
const ownership = shallowRef<OverlayOwnership | null>(null)
const active = computed(() => props.open && props.interactive && ownsOverlay(ownership.value))
const isResizableDrawer = computed(() => props.resizable && props.variant === 'drawer')
const {
  beginResize,
  drawerMaximum,
  drawerMinimum,
  drawerWidth,
  measureViewport,
  resizeFromKeyboard,
  resizing,
  restoreDrawerWidth,
  viewportWidth,
} = useDrawerWidth({
  active: () => active.value,
  defaultWidth: () => props.drawerDefaultWidth,
  maxWidth: () => props.drawerMaxWidth,
  minWidth: () => props.drawerMinWidth,
  resizable: () => isResizableDrawer.value,
  storageKey: () => props.widthStorageKey,
})
const { paneFits, paneWidest } = usePaneFit({
  isDialog: () => props.variant === 'dialog',
  moving: () => resizing.value,
  room: () => props.paneRoom,
  viewportWidth: () => viewportWidth.value,
  width: () => drawerWidth.value,
})
const paneResizing = ref(false)
useSurfaceGlide(surface, () => Boolean(props.pane))
const { notePaneFocus, walkPanes } = usePaneWalk(() => surface.value)
const { focusSurface, roundToFirst, roundToLast, stopWaiting, trapFocus } = useOverlayFocus({
  active: () => active.value,
  isDrawer: () => props.variant === 'drawer',
  surface: () => surface.value,
})

// 4px under the window's top edge, above the first chrome label at every width
// (9px at 390), so the edge crosses no label; the dialog's gutter above is cancelled,
// whatever the window leaves of it.
const TOP_EDGE = 'calc(4px - var(--space-dialog-gutter))'
const TOP_PLACEMENT = { alignSelf: 'start', marginBlockStart: TOP_EDGE, maxHeight: '86dvh' }
const surfaceStyle = computed(() => {
  if (props.placement === 'top') return TOP_PLACEMENT
  // Two panes are as wide as they are together; the first holds this surface's own width.
  if (props.pane) return null
  const width = viewportWidth.value <= DRAWER_NARROW_BREAKPOINT ? '100vw' : `${drawerWidth.value}px`
  return isResizableDrawer.value ? { width } : null
})
const mainStyle = computed(() =>
  props.pane && props.variant === 'drawer' ? { width: `${drawerWidth.value}px` } : null,
)
/** A pane beside it makes what the surface holds one of two regions, each with its name. */
const mainRegion = computed(() =>
  props.pane ? ({ 'role': 'region', 'aria-labelledby': mainNameId } as const) : {},
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
  active.value
    ? ({
        'role': 'dialog',
        'aria-modal': 'true',
        'aria-label': props.ariaLabel || undefined,
        'aria-labelledby': props.title ? titleId : undefined,
      } as const)
    : ({ 'aria-hidden': true, 'inert': true } as const),
)

function closeOverlay(event: Event) {
  if (!active.value || event.defaultPrevented) return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

/**
 * A press may land on the scrim only because it has appeared under a pointer that stood
 * still, as the second of a double click does. That is no wish to close, and it took the
 * card away as it arrived.
 */
function pressOnScrim(event: MouseEvent) {
  if (!isStrayPress(event)) closeOverlay(event)
}

function release() {
  releaseOverlayOwnership(ownership.value)
  ownership.value = null
}

watch(
  [() => props.open, () => props.interactive],
  ([open, interactive]) => {
    if (open && interactive) {
      // Only the top surface claims focus and scroll. A mounted drawer can remain
      // visible under a command dialog without becoming a second dialog owner.
      ownership.value = claimOverlayOwnership(() => surface.value, props.layer, closeOverlay)
      measureViewport()
      restoreDrawerWidth()
    } else {
      release()
    }
  },
  { immediate: true, flush: 'post' },
)

function keydownInSurface(event: KeyboardEvent) {
  if (event.key === 'F6' && active.value) walkPanes(event)
  else trapFocus(event)
}

watch(
  [active, () => props.contentKey],
  () => {
    resizing.value &&= active.value
    void focusSurface()
  },
  { flush: 'post', immediate: true },
)

watch(
  [() => props.open, active, paneFits],
  ([open, isActive, fits]) => {
    if (props.paneRoom !== undefined) emit('pane-fit', open ? { active: isActive, fits } : null)
  },
  { flush: 'post', immediate: true },
)

onUnmounted(release)

/*
 * How the template below stands.
 *
 * The enter and leave are the six-class pattern, on the one component that owns every
 * overlay surface. A drawer and a dialog arrived by appearing, which reads as a jump cut:
 * the operator has to work out what changed. There is no separate wrapper component for
 * this because there is exactly one consumer, and a reusable transition with one consumer
 * is ceremony. The scrim fades; the surface arrives under its own power. A drawer comes in
 * from the edge it is attached to, and a dialog steps up from just below, because a dialog
 * that scales up from nothing reads as an alert. Both leave the way they came, which is
 * what tells the operator the surface went back where it was rather than being destroyed.
 *
 * Escape reaches the top host through the overlay stack, which hears it on the document:
 * focus that fell out of the surface still closes it. The focusable surface is the section.
 *
 * The scrim is a pointer affordance by definition: clicking outside a dialog dismisses it.
 * The keyboard equivalent is Escape. A press leaves focus in the surface until it closes,
 * for the keys that read it. At 42% of a near-black it dimmed the canvas by about a step of
 * the grey ramp, which is the distance between two ordinary surfaces, so a dialog looked
 * like one more panel: it has to read as out of reach, not merely tinted.
 *
 * Every host keeps its scrim for as long as it stands, covered or not, so each layer dims
 * what is under it and a layer arriving or leaving only moves that by its own fade. Only the
 * top one had a scrim: the one under a new layer went at once, while the new one started from
 * nothing, so what lay under both lit up for a frame and then faded back, and darkened past
 * its place as the top layer left. A covered scrim is out of reach under the layer on top.
 *
 * The section's role is inside `modality`, which the a11y rule cannot look into: it reads
 * the attributes written on the element and this one carries a computed object. An
 * interactive surface is `role="dialog"` with a name and `aria-modal`, and a passive one is
 * `inert` and hidden, so its handlers never reach a plain `section`.
 *
 * What the surface holds stands in one box whether or not a pane stands beside it, or
 * opening one would mount it again and take any draft in it away.
 *
 * A dialog floats with a gutter round it, and on a window as narrow as one where the drawer
 * takes the whole width, it takes the whole width too. The 20px gutter and the inset of the
 * dialog's own body inside it took a phone's column twice over: with a question's sheet and
 * an option row inside them, an option's text had 184px of 390. What the dialog holds learns
 * which edge it stands at from `--space-dialog-gutter`, `--space-dialog-inset` and
 * `--radius-dialog`, which the tokens give for a floating dialog and this re-points across
 * the window (`DialogFrame` reads them).
 */
</script>

<template>
  <Teleport to="body">
    <Transition
      name="overlay"
      appear
      @before-leave="outOfReach"
    >
      <div
        v-if="open"
        class="overlay-host"
        :class="[`overlay-${variant}`, `overlay-layer-${layer}`, { 'is-passive': !interactive }]"
      >
        <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
        <div
          v-if="interactive"
          class="overlay-scrim"
          @click="pressOnScrim"
          @mousedown.prevent
        />
        <!-- The stops at the ends, where a Tab that has run out of controls lands. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <span
          v-if="active"
          class="visually-hidden"
          tabindex="0"
          @focus="roundToLast"
        />
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <section
          ref="surface"
          class="overlay-surface"
          tabindex="-1"
          :class="[
            `overlay-surface-${variant}`,
            surfaceClass,
            { 'is-resizing': resizing || paneResizing, 'has-pane': pane },
          ]"
          :style="surfaceStyle"
          v-bind="modality"
          @keydown="keydownInSurface"
          @focusin="notePaneFocus"
          @pointerdown="stopWaiting"
        >
          <OverlayResizer
            v-if="isResizableDrawer && viewportWidth > DRAWER_NARROW_BREAKPOINT"
            :label="resizeLabel || ariaLabel"
            :minimum="drawerMinimum"
            :maximum="drawerMaximum"
            :now="drawerWidth"
            @pointerdown="beginResize"
            @keydown="resizeFromKeyboard"
          />
          <span
            v-if="title"
            :id="titleId"
            class="visually-hidden"
            >{{ title }}</span
          >
          <div
            class="overlay-pane-main"
            :style="mainStyle"
            data-overlay-pane
            v-bind="mainRegion"
          >
            <span
              v-if="pane"
              :id="mainNameId"
              hidden
              >{{ pane.main }}</span
            >
            <slot />
          </div>
          <OverlayPane
            v-if="pane"
            :active="active"
            :label="pane.label"
            :folded-label="pane.folded"
            :resize-label="pane.resize"
            :variant="variant"
            :widest="paneWidest"
            @close="emit('pane-close')"
            @resizing="(moving) => (paneResizing = moving)"
          >
            <slot name="pane" />
          </OverlayPane>
        </section>
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <span
          v-if="active"
          class="visually-hidden"
          tabindex="0"
          @focus="roundToFirst"
        />
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

.overlay-scrim {
  position: absolute;
  inset: 0;
  background: var(--color-overlay-scrim);
}

/* The host holds still for as long as what it holds is moving. The Transition reads the
   duration off this element and nothing here moves, so with none of its own it removed
   the host a frame into its leave, before the surface had gone anywhere. An enter got
   away with it only because a browser does not stop a transition it has begun. Opacity
   never changes here and no end event comes: the Transition ends on its own timer, set
   from this duration. Without this rule, unused as it looks, a close does not play. */
.overlay-enter-active,
.overlay-leave-active {
  transition: opacity var(--duration-surface) var(--ease-out);
}

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
  padding: var(--space-dialog-gutter);
}

/* What the surface holds is its own measure and its own scroller. A dialog stops growing
   at 640px however wide the monitor gets, so what its fields can afford is a question
   about the dialog; the window kept answering a different one. */
.overlay-pane-main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  container: overlay / inline-size;
}

.overlay-surface-dialog {
  display: flex;
  flex-direction: column;
  width: min(640px, calc(100vw - 2 * var(--space-dialog-gutter)));
  max-height: calc(100dvh - 2 * var(--space-dialog-gutter));
}

/* Two panes side by side, the first at the surface's own width. A dialog and its pane
   stand as one height, so their heads are level and neither moves as the other's text
   grows; they are centred as a pair by the host. */
.overlay-surface.has-pane {
  flex-direction: row;
  width: auto;

  & .overlay-pane-main {
    flex: 0 0 auto;
  }

  &.overlay-surface-dialog {
    height: calc(100dvh - 2 * var(--space-dialog-gutter));

    & .overlay-pane-main {
      width: min(640px, calc(100vw - 2 * var(--space-dialog-gutter)));
    }
  }
}

/* The drawer's ground is `--color-surface`, so the default sheet — one step
   above it — is already the right tone for an object lying on the drawer. It
   used to be re-pointed to the drawer's own tone, which made every comment
   card the same colour as the panel it lay on: an invisible box whose padding
   read as the text sitting off its column. */
.overlay-surface-drawer {
  position: absolute;
  inset: 0 0 0 auto;
  display: flex;
  flex-direction: column;
  width: min(700px, 96vw);
  border-inline-start: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: var(--shadow-overlay);

  &.is-resizing,
  &.is-resizing * {
    /* stylelint-disable-next-line declaration-no-important -- during a drag the
     pointer must not pick up the cursor of whatever it passes over */
    cursor: col-resize !important;
    user-select: none;
  }
}

/* The one viewport question left in the overlay: how wide a surface stands. A container cannot. */
@media (width <= 620px) {
  .overlay-surface-drawer {
    width: 100vw;
    box-shadow: none;
  }

  .overlay-dialog {
    --radius-dialog: 0;
    --space-dialog-gutter: 0px;
    --space-dialog-inset: var(--space-4);
  }
}
</style>
