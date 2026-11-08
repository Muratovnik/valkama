<script setup lang="ts">
import { computed, ref } from 'vue'

import OverlayHeader from '@/shared/ui/OverlayHeader.vue'
import OverlayHost from '@/shared/ui/OverlayHost.vue'
import type { OverlayPaneNames, PaneFit } from '@/shared/ui/overlayPanes.ts'

const props = withDefaults(
  defineProps<{
    closeLabel: string
    open: boolean
    title: string
    busy?: boolean
    /** Which record this dialog is about: a card number and its title. */
    context?: string
    /** Why the last submit did not go through. */
    error?: string
    pane?: OverlayPaneNames | null
    paneRoom?: number
    placement?: 'center' | 'start' | 'top'
    /** What it holds grows as it is read, so the scrollbar's room is kept from the start. */
    steadyScroll?: boolean
    subtitle?: string
    surfaceClass?: string
  }>(),
  { subtitle: '', surfaceClass: '', busy: false, context: '', error: '', placement: 'center' },
)

const emit = defineEmits<{
  'close': []
  'pane-close': []
  'pane-fit': [fit: PaneFit | null]
  'submit': []
}>()

/** Absent rather than false, because `aria-busy="false"` is a claim and not a default. */
const busyMark = computed(() => props.busy || undefined)
/**
 * The box that scrolls what the dialog holds, handed to what stands in the `rail`: a column of
 * the body's start inset, beside it and still while it scrolls, for a way through what it holds.
 */
const body = ref<HTMLElement | null>(null)
</script>

<template>
  <OverlayHost
    layer="command"
    :open="open"
    :title="title"
    :aria-label="title"
    :surface-class="surfaceClass"
    :placement="placement"
    :pane="pane"
    :pane-room="paneRoom"
    @close="emit('close')"
    @pane-close="emit('pane-close')"
    @pane-fit="(fit) => emit('pane-fit', fit)"
  >
    <form
      class="dialog-frame"
      :class="{ 'is-paired': pane, 'has-rail': $slots.rail }"
      :aria-busy="busyMark"
      @submit.prevent="emit('submit')"
    >
      <OverlayHeader
        class="dialog-frame-head"
        :title="title"
        :subtitle="subtitle"
        :context="context"
        :close-label="closeLabel"
        :focusable-title="Boolean(pane)"
        @close="emit('close')"
      />
      <div
        v-if="$slots.rail"
        class="dialog-frame-rail"
      >
        <slot
          name="rail"
          :scroller="body"
        />
      </div>
      <div
        ref="body"
        class="dialog-frame-body"
        :class="{ 'is-steady': steadyScroll }"
      >
        <slot />
        <!-- A refused submit is announced where the operator is looking: at the
             end of the form they just tried to send, not in a corner banner. -->
        <p
          v-if="error"
          class="dialog-frame-error"
          role="alert"
        >
          {{ error }}
        </p>
      </div>
      <footer
        v-if="$slots.footer"
        class="dialog-frame-footer"
      >
        <slot name="footer" />
      </footer>
    </form>
    <!-- Outside the form: a button in a form sends it unless told otherwise, and what is
         read beside a dialog must not answer for it. -->
    <template #pane>
      <slot name="pane" />
    </template>
  </OverlayHost>
</template>

<style scoped>
/* A dialog floats inset from the window, or on a narrow one stands across all of it, and its
   host, which this always is in, says which (`OverlayHost`): across the window it keeps no
   corners and a smaller inset, the same for its head, its body and its foot, so that their
   edges stay in one line. */
.dialog-frame {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  grid-template-columns: minmax(0, 1fr);
  max-height: calc(100dvh - 2 * var(--space-dialog-gutter));
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-dialog);
  box-shadow: var(--shadow-overlay);

  &.is-paired {
    flex: 1 1 auto;
  }
}

/* A rail takes the body's start inset for its column, so the words start where they did and
   the head, the body and the foot keep one edge. Where the dialog stands across a phone-wide
   window that inset is 16px, narrower than a target, and its edge is the screen's, which a
   finger swipes for the system: there the host draws no rail (`--display-dialog-rail`), and
   the empty column is the inset it was. */
.dialog-frame.has-rail {
  grid-template-columns: var(--space-dialog-inset) minmax(0, 1fr);

  > .dialog-frame-head,
  > .dialog-frame-footer {
    grid-column: 1 / -1;
  }

  /* Placed, not left to flow: with no rail drawn the body would take the rail's column. */
  > .dialog-frame-body {
    grid-row: 2;
    grid-column: 2;
    padding-inline-start: 0;
  }
}

/* What the rail holds stands on the middle of the body's height, and no taller than it. */
.dialog-frame-rail {
  display: var(--display-dialog-rail, flex);
  flex-direction: column;
  grid-row: 2;
  grid-column: 1;
  justify-content: center;
  min-height: 0;
  overflow: hidden;
}

/* Its rows stand at the top: beside a pane the frame is as tall as the window, and rows
   stretched to fill it opened a hole between the head and the first of them.
   What it holds that sticks to its top or bottom edge sticks inside its inset, as the browser
   keeps a stuck box clear of the scroller's padding, so the inset passes over the top of it
   with what scrolls showing through: it is told to stand that much further out
   (`--size-stuck-top`, `--size-stuck-bottom`), at the very edge. */
.dialog-frame-body {
  --size-stuck-top: calc(-1 * var(--space-dialog-inset));
  --size-stuck-bottom: calc(-1 * var(--space-dialog-inset));

  display: grid;
  gap: var(--space-6);
  align-content: start;
  min-height: 0;
  padding: var(--space-dialog-inset);
  overflow-y: auto;
}

/* Paid for out of the end inset, so the words end where they would with no scrollbar. One that
   arrived later narrowed all of it by its width, and every line broke somewhere else. */
.dialog-frame-body.is-steady {
  padding-inline-end: calc(var(--space-dialog-inset) - var(--size-scrollbar));
  scrollbar-gutter: stable;
}

/* The head draws its own inset, the floating one; across the window it takes the body's. */
.dialog-frame > .dialog-frame-head {
  padding: var(--space-dialog-inset);
}

.dialog-frame-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--font-size-dense);
}

.dialog-frame-footer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  justify-content: flex-end;
  align-items: center;
  padding: var(--space-4) var(--space-dialog-inset);
  border-top: 1px solid var(--color-rule);
}
</style>
