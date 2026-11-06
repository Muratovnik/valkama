<script setup lang="ts">
/**
 * Whether the app is connected, and the button that asks it to catch up.
 *
 * One control, not a control beside a status line: the state is what a refresh is
 * about, so the dot, the word and the action are one target. The button is the
 * refresh action and says so by its icon and its tooltip; the word "Refresh"
 * printed under the state used to be a second line inside the control that does
 * it, and a centred dot beside a two-line block lines up with neither line.
 *
 * A lost connection is said here and nowhere else: the word and the dot change,
 * the tooltip says what happens next and what the button does, and assistive
 * technology hears it once. It used to be a paragraph put into the flow above
 * the views, which moved the board and the graph down by its height for as long
 * as the server was away and asked for a refresh the app does by itself.
 *
 * On a narrow rail the word is hidden and the dot is all there is, and a phone
 * cannot hover. So there, pressing the dot while the connection is lost opens
 * the sentence in a panel, and the panel keeps the refresh: the press used to be
 * the refresh alone, and a lost connection could not be explained by the rail.
 */
import { computed, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { statePresentation } from '@/shared/lib/uiSystem.ts'
import InfoTip from '@/shared/ui/InfoTip.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = withDefaults(
  defineProps<{ connection?: 'connecting' | 'live' | 'reconnecting'; refreshing?: boolean }>(),
  { connection: 'connecting', refreshing: false },
)

const emit = defineEmits<{ refresh: [] }>()
const { t } = useI18n()
const noticeId = useId()
const lost = computed(() => props.connection === 'reconnecting')
/** What the tooltip and assistive technology are told while the connection is lost. */
const notice = computed(() => (lost.value ? t('connection.lost') : ''))
const describedBy = computed(() => (lost.value ? noticeId : undefined))
const title = computed(() =>
  lost.value ? `${notice.value} ${t('refresh.title')}` : t('refresh.title'),
)

/**
 * Whether the rail hides the word, which is when the press opens the sentence.
 * The rail's container query decides it and this asks the same question: the
 * word's own display. The control's width changes with the rail, so a resize
 * observer on the control is told every time the answer may change.
 */
const control = useTemplateRef<HTMLButtonElement>('control')
const tip = useTemplateRef<{ close: () => void }>('tip')
const compact = ref(false)
function measure() {
  const copy = control.value?.querySelector('.connection-copy') ?? null
  compact.value = copy !== null && getComputedStyle(copy).display === 'none'
}
/** The press opens the sentence: lost on a narrow rail, where the word is not there to say it. */
const opensSentence = computed(() => lost.value && compact.value)

let observer: ResizeObserver | undefined
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && control.value) {
    observer = new ResizeObserver(measure)
    observer.observe(control.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())

// The sentence says the connection is lost; once it is back the panel has nothing to say.
watch(lost, (now) => {
  if (!now) tip.value?.close()
})

function press(toggle: (event?: Event) => void, event: MouseEvent) {
  if (opensSentence.value) toggle(event)
  else emit('refresh')
}
</script>

<template>
  <div class="nav-tip">
    <InfoTip
      ref="tip"
      :label="notice"
      :active="opensSentence"
      interactive
    >
      <template #trigger="{ toggle, popup }">
        <button
          ref="control"
          type="button"
          class="nav-refresh"
          :class="{ refreshing }"
          :data-tone="statePresentation('connection-lifecycle', connection).tone"
          :disabled="refreshing"
          :title="title"
          :aria-describedby="describedBy"
          :aria-controls="popup.controls"
          :aria-expanded="popup.expanded"
          @click="press(toggle, $event)"
        >
          <span
            class="connection-dot"
            aria-hidden="true"
          />
          <span class="connection-copy">{{ t(`status.${connection}`) }}</span>
          <VIcon
            class="refresh-icon"
            name="refresh"
            :size="18"
            :stroke-width="1.7"
          />
        </button>
      </template>
      <p class="nav-tip-text">{{ notice }}</p>
      <VButton
        class="nav-tip-action"
        variant="secondary"
        :disabled="refreshing"
        @click="emit('refresh')"
      >
        {{ t('refresh.title') }}
      </VButton>
    </InfoTip>
  </div>
  <p
    :id="noticeId"
    class="visually-hidden"
    role="status"
  >
    {{ notice }}
  </p>
</template>

<style scoped>
.nav-refresh {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: 8px minmax(0, 1fr) 20px;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
  min-height: var(--size-control-height);
  padding: 0 var(--space-3);
  border: 1px solid transparent;
  color: var(--color-text-on-dark-muted);
  text-align: left;
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--color-text-on-dark);
    background: var(--color-navigation-raised);
  }

  &:disabled {
    opacity: 0.72;
    cursor: wait;
  }
}

/* The size, the stroke, the fill and the colour are the icon's own props and
   Lucide's own defaults now. They were four declarations on a bare `svg` inside
   this control — a bet on what the icon library renders — and the size among them
   was overriding the size the template asked for, so the prop said 20 while the
   interface drew 18. What is left is the one thing no prop can say: this glyph
   turns while the refresh it belongs to is in flight. */
.nav-refresh.refreshing .refresh-icon {
  animation: refresh-spin 0.7s linear infinite;
}

/* One dot for the whole connection: the rail rations a status down to this, which
   is why it is a colour and not a word beside a word. The operational state is
   translated once by the shared presentation system; this component consumes
   only that canonical tone. */
.connection-dot {
  width: 8px;
  height: 8px;
  background: var(--color-text-tertiary);
  border-radius: 50%;

  .nav-refresh[data-tone='success'] & {
    background: var(--color-success);
  }

  .nav-refresh[data-tone='warning'] & {
    background: var(--color-warning);
  }

  /* A forced palette clears a fill, and the dot is one: on a narrow rail it was the button's
     only mark. It says a state, so it takes the palette's ink and stays out of its reach. */
  @media (forced-colors: active) {
    &,
    .nav-refresh[data-tone] & {
      background: CanvasText;
      forced-color-adjust: none;
    }
  }
}

.connection-copy {
  min-width: 0;
  color: var(--color-text-on-dark);
  font: var(--font-label);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The narrow rail keeps the dot and drops everything that needs a line: the word
   and the glyph beside it. The rail declares the `nav` container, so this control
   answers the question itself rather than being reached into by class name from
   the shell stylesheet. */
@container nav (width < 150px) {
  .nav-refresh {
    grid-template-columns: 1fr;
    justify-items: center;
    padding-inline: 0;
  }

  .connection-copy,
  .refresh-icon {
    display: none;
  }
}

/* The help panel's anchor is the whole control: the cell takes the footer's
   width, and the control fills the anchor, so the footer lays out as it did
   before the panel. */
.nav-tip {
  display: grid;
  min-width: 0;
}

.nav-tip-text {
  margin: 0 0 var(--space-2);
}

/* The action's label is a sentence in a narrow panel: it wraps, and the control
   grows to hold its lines instead of clipping them at the panel's edges. */
.nav-tip-action {
  inline-size: 100%;
  min-block-size: var(--size-control-height);
  padding-block: var(--space-2);
  text-align: center;
  white-space: normal;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
