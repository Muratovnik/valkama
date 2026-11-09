<script setup lang="ts">
/**
 * A picture kept for an item, drawn where its text names it (`RichInlines`).
 *
 * In the text it stands no wider than the text and no taller than a few lines of it, so
 * a screenshot does not push the rest of a comment out of sight; it is a button that opens
 * it at its own size, in the product's dialog. Not a link to the file in a new tab: the
 * server hands a picture only to this page (`Sec-Fetch-Site: same-origin`), and the
 * desktop app opens every new window in the system browser, where it would be refused.
 *
 * The address is the picture's hash, not the item's: it serves the picture while any item
 * still holds it, whichever item's text names it. A picture that no longer loads — every
 * item that held it was deleted — is the words written for it, as a reader without
 * pictures hears it.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { servedImagePath } from '@/shared/lib/pastedImages.ts'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const props = defineProps<{ alt: string; sha256: string }>()
const { t } = useI18n()

const source = computed(() => servedImagePath(props.sha256))
const name = computed(() => props.alt.trim() || t('pastedImages.unnamed'))
const viewing = ref(false)
const failed = ref(false)
</script>

<template>
  <span
    v-if="failed"
    class="rich-image-missing"
    >{{ name }}</span
  ><button
    v-else
    v-tooltip.name="t('pastedImages.open', { name })"
    type="button"
    class="rich-image"
    :aria-label="t('pastedImages.open', { name })"
    @click="viewing = true"
  >
    <img
      class="rich-image-thumb"
      alt=""
      decoding="async"
      :src="source"
      @error="failed = true"
    /></button
  ><DialogFrame
    v-if="viewing"
    :open="viewing"
    :title="name"
    :close-label="t('pastedImages.close')"
    @close="viewing = false"
  >
    <!-- Scrolled by keys as well as by a wheel: a picture wider than the dialog is read
         in parts, and a box that scrolls is a stop for the keyboard (WCAG 2.1.1). -->
    <!-- eslint-disable-next-line vuejs-accessibility/no-noninteractive-tabindex -->
    <div
      class="rich-image-full"
      tabindex="0"
      role="group"
      :aria-label="name"
    >
      <img
        class="rich-image-actual"
        :src="source"
        :alt="name"
      />
    </div>
  </DialogFrame>
</template>

<style scoped>
/* On a line of its own, as a paste writes it, at the picture's size or the text's width
   and six lines' height, whichever is less: a held comment shows eight lines
   (`CollapsibleText`), and a picture any taller left a held one only the words above it.
   It stands on the recessed ground of a code span, a hair wider than itself, so a white
   screenshot on a white card still has an edge; the press is the picture and that rim. */
.rich-image {
  display: block;
  inline-size: fit-content;
  max-inline-size: 100%;
  padding: var(--space-half);
  margin-block: var(--space-1);
  border: 0;
  background: var(--color-surface-recess);
  overflow: hidden;
  border-radius: var(--radius-status);
  cursor: zoom-in;
}

.rich-image-thumb {
  display: block;
  inline-size: auto;
  max-inline-size: min(100%, 32rem);
  block-size: auto;
  max-block-size: 6lh;
  object-fit: contain;
}

.rich-image-missing {
  color: var(--color-text-muted);
}

/* At its own pixels, scrolled in both directions inside the dialog when it is larger. */
.rich-image-full {
  max-block-size: calc(100dvh - 12rem);
  overflow: auto;
  overscroll-behavior: contain;
}

.rich-image-actual {
  display: block;
  max-inline-size: none;
}
</style>
