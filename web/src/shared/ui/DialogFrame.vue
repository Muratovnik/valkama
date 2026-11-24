<script setup lang="ts">
import { computed, ref } from 'vue'

import OverlayHeader from '@/shared/ui/OverlayHeader.vue'
import OverlayHost from '@/shared/ui/OverlayHost.vue'
import type { OverlayPaneNames, PaneFit } from '@/shared/ui/overlayPanes.ts'
import type { TextRun } from '@/shared/ui/textRuns.ts'

const props = withDefaults(
  defineProps<{
    closeLabel: string
    open: boolean
    title: string
    busy?: boolean
    /** Which record this dialog is about: a card number and its title, as `OverlayHeader` takes it. */
    context?: string | readonly TextRun[]
    /** Why the last submit did not go through. */
    error?: string
    /**
     * The words `note` can come to say, whose room is held over the foot from the start, so that
     * saying them moves nothing in the form or the foot.
     */
    heldNote?: string
    /**
     * What the form says over the foot while it stands, such as what a change will mean when it
     * is saved; `noteId` is its id, for the field it describes.
     */
    note?: string
    noteId?: string
    pane?: OverlayPaneNames | null
    paneRoom?: number
    placement?: 'center' | 'start' | 'top'
    /** What it holds grows as it is read, so the scrollbar's room is kept from the start. */
    steadyScroll?: boolean
    subtitle?: string
    surfaceClass?: string
  }>(),
  {
    subtitle: '',
    surfaceClass: '',
    busy: false,
    context: '',
    error: '',
    heldNote: '',
    note: '',
    noteId: undefined,
    placement: 'center',
  },
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
 * The box that scrolls what the dialog holds, handed to what stands among the head's `actions`,
 * still while it scrolls, for a way through what it holds.
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
      :class="{ 'is-paired': pane }"
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
      >
        <template
          v-if="$slots.actions"
          #actions
        >
          <slot
            name="actions"
            :scroller="body"
          />
        </template>
      </OverlayHeader>
      <div
        ref="body"
        class="dialog-frame-body"
        :class="{ 'is-steady': steadyScroll }"
      >
        <slot />
        <!-- A refused submit is announced where the operator is looking: at the
             end of the form they just tried to send, not in a corner banner, and
             above the foot's buttons while the form is longer than the dialog. What
             the form says of a change stands there too, over the refusal. -->
        <div
          v-if="error || note || heldNote"
          class="dialog-frame-said"
          :class="{ 'is-said': Boolean(error || note) }"
        >
          <div
            v-if="note || heldNote"
            class="held-room"
          >
            <small
              v-if="note"
              :id="noteId"
              class="dialog-frame-note"
              >{{ note }}</small
            >
            <small
              v-if="heldNote"
              class="held-room-unseen dialog-frame-note"
              aria-hidden="true"
              >{{ heldNote }}</small
            >
          </div>
          <p
            v-if="error"
            class="dialog-frame-error"
            role="alert"
          >
            {{ error }}
          </p>
        </div>
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

<style scoped src="@/shared/ui/heldRoom.css"></style>

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

/* What the form says of a change and why a submit was refused, the refusal under it, nearer
   the buttons: at the end of the form, and while the form is longer than the dialog, at the
   body's lower edge over what scrolls under it, right above the foot's buttons. At the end of a
   long form alone a refusal stood out of sight under the fold, and a press on Save seemed to do
   nothing. It sticks at the very edge (`--size-stuck-bottom`) on the dialog's own ground, which
   reaches that edge and a step above its words, given back by its margins so that a form that
   fits lays it where it always stood. While only held room stands there it has no ground and
   takes no press, so what scrolls under it shows and answers. */
.dialog-frame-said {
  position: sticky;
  inset-block-end: var(--size-stuck-bottom);
  z-index: 1;
  display: grid;
  gap: var(--space-3);
  padding-block: var(--space-3) var(--space-dialog-inset);
  margin: calc(-1 * var(--space-3)) 0 calc(-1 * var(--space-dialog-inset));
  pointer-events: none;

  &.is-said {
    background: var(--color-surface);
    pointer-events: auto;
  }
}

.dialog-frame-note {
  color: var(--color-text-muted);
  font: var(--font-detail);
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
