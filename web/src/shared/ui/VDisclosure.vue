<script setup lang="ts">
/**
 * A part of a surface that opens on request: technical details, a run's record, the rest of
 * a report under its preview.
 *
 * These were the browser's `<details>`, and its `<summary>` drew the browser's triangle, set
 * in whatever weight the words around it had: inside a flex row the triangle stood on a line
 * of its own above them, and in a 600 summary holding a `<strong>` it came out at 900. The
 * toggle here is the bare `text` weight that every other disclosure in the product wears,
 * with the product's chevron on the line of its words, standing on the content's edge as a
 * heading's first letter does.
 *
 * What it opens stays in the document while closed, as a `<details>` body did, hidden until
 * the browser's find reaches into it, which opens it. Reka's collapsible owns that, the open
 * state and the toggle's `aria-expanded`. The body's id is named here: Reka gives the body
 * its id only as the body is set up, after the toggle has drawn, so the toggle came out
 * naming an empty `aria-controls` until it was first pressed.
 *
 * A host may set the type of the toggle's words (`--font-disclosure`), give the toggle's line
 * an inset and a fill of its own (`--space-disclosure-inset`, `--color-disclosure-head`) and
 * change the step to what it opens (`--space-disclosure-gap`), on this component's root; the
 * defaults are in `tokens.css`. `heading` puts the toggle inside a heading of that rank, for
 * a disclosure whose words name a section of the outline.
 */
import { computed, useId } from 'vue'

import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'

import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

withDefaults(defineProps<{ heading?: 'h3' | 'h4' }>(), { heading: undefined })

const open = defineModel<boolean>('open', { default: false })
const bodyId = useId()
const chevron = computed(() => (open.value ? 'chevron-down' : 'chevron-right'))
</script>

<template>
  <CollapsibleRoot
    v-model:open="open"
    :unmount-on-hide="false"
    as-child
  >
    <div class="disclosure">
      <component
        :is="heading ?? 'div'"
        class="disclosure-head"
      >
        <CollapsibleTrigger as-child>
          <VButton
            class="disclosure-toggle"
            variant="text"
            size="inline"
            :aria-controls="bodyId"
          >
            <VIcon
              :name="chevron"
              :size="16"
            />
            <span class="disclosure-summary"><slot name="summary" /></span>
          </VButton>
        </CollapsibleTrigger>
      </component>
      <CollapsibleContent as-child>
        <div
          :id="bodyId"
          class="disclosure-body"
        >
          <slot />
        </div>
      </CollapsibleContent>
    </div>
  </CollapsibleRoot>
</template>

<style scoped>
.disclosure {
  display: grid;
  min-width: 0;
}

.disclosure-head {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: var(--space-disclosure-inset);
  margin: 0;
  background: var(--color-disclosure-head);
}

/* Bare at rest, its chevron where the content it opens starts: the margin takes back the
   inset the toggle's fill keeps under the pointer. */
.disclosure-toggle {
  margin-inline-start: calc(-1 * var(--space-2));
}

.disclosure-summary {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  font: var(--font-disclosure);
}

/* Closed, the body keeps its box with nothing drawn in it, so the space between it and the
   toggle belongs to it only while it is open. */
.disclosure-body {
  min-width: 0;

  &:not([hidden]) {
    margin-block-start: var(--space-disclosure-gap);
  }
}
</style>
