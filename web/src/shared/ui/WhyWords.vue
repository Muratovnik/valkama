<script setup lang="ts">
/**
 * Words with a why behind them — what an asker recommends and why, or a figure and what it
 * counts: pointing at the words, focusing them from the keyboard or pressing them shows the why
 * beside them, so a finger reaches it as the pointer does. Without a why the words are what they
 * were, and nothing to press. The words are `text`, or the default slot where they are drawn in
 * more than one ink; `text` names them either way.
 *
 * The press is its own: in a form it stands inside the option's `<label>`, where a button is the
 * one thing a press on the label does not pass to the option's control. The pointer opens the
 * why on a mouse only and leaves it a moment after leaving, so it can move onto the why; a
 * finger's press and keyboard focus open it until focus leaves, and Escape closes it.
 *
 * A reader hears the why with the words: it stands hidden beside them, so whatever names the
 * words as what describes it (an option's control does) hears both.
 */
import { onBeforeUnmount, ref, useId } from 'vue'

import { plainText } from '@/shared/lib/richText.ts'
import InfoTip from '@/shared/ui/InfoTip.vue'
import RichText from '@/shared/ui/RichText.vue'

withDefaults(
  defineProps<{
    /** The words, as the line says them. */
    text: string
    /** Whether the press is a tab stop; the host's rule for its own presses in the row. */
    tabStop?: number
    /** Markdown: why the words say what they say. */
    why?: string
  }>(),
  { why: undefined, tabStop: undefined },
)
const whyId = `${useId()}-why`
const tip = ref<InstanceType<typeof InfoTip> | null>(null)
/** How long the why stays after the pointer leaves the words, for it to reach the why. */
const LINGER_MS = 300
let leaving: ReturnType<typeof setTimeout> | undefined

function stay() {
  clearTimeout(leaving)
}
function leave(event: PointerEvent) {
  if (event.pointerType !== 'mouse') return
  stay()
  leaving = setTimeout(() => tip.value?.close(), LINGER_MS)
}
/** Opens the why unless it is open; a press or focus never closes it. */
function show(open: boolean, toggle: (event?: Event) => void, event: Event) {
  stay()
  if (!open) toggle(event)
}
function point(open: boolean, toggle: (event?: Event) => void, event: PointerEvent) {
  if (event.pointerType === 'mouse') show(open, toggle, event)
}
onBeforeUnmount(stay)
</script>

<template>
  <span v-if="!why"
    ><slot>{{ text }}</slot></span
  >
  <span v-else>
    <InfoTip
      ref="tip"
      class="why-words-tip"
      :label="text"
    >
      <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
      <div
        class="why-words-why"
        @pointerenter="stay"
        @pointerleave="leave"
      >
        <RichText :source="why" />
      </div>
      <template #trigger="{ toggle, popup }">
        <button
          type="button"
          class="why-words"
          :tabindex="tabStop"
          :aria-describedby="whyId"
          @pointerenter="point(popup.expanded === true, toggle, $event)"
          @pointerleave="leave"
          @focus="show(popup.expanded === true, toggle, $event)"
          @click="show(popup.expanded === true, toggle, $event)"
        >
          <slot>{{ text }}</slot>
        </button>
      </template>
    </InfoTip>
    <span
      :id="whyId"
      class="visually-hidden"
      >{{ plainText(why) }}</span
    >
  </span>
</template>

<style scoped>
/* On the words' baseline, as the words without a why stand. */
.why-words-tip {
  vertical-align: baseline;
}

/* The words as the row writes them, a line tall as they are, marked as having more to show. */
.why-words {
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: inherit;
  text-decoration: underline dotted;
  text-underline-offset: 0.2em;
  background: none;
  cursor: help;
}

.why-words-why {
  overflow-wrap: anywhere;
}
</style>
