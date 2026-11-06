<script setup lang="ts">
/**
 * A work item as the card a reference in text shows while the pointer rests on
 * it: what the item is and where it stands, without opening it.
 *
 * Its reference first, then what is news about it — a priority or a kind that is
 * not the ordinary one — and its state, with what it waits on if anything does;
 * the whole title, wrapped wherever it has to be; who holds it and how far its
 * steps are; and when it last changed or closed, after the project it comes
 * from when that is not the open one. Each fact is the facet registry's
 * (`surface: 'preview'`), drawn as a tile draws its own, so a stale claim reads
 * the same here as on the board.
 *
 * Until the item is read the reference stands alone with one line under it, and
 * a refusal says so in a line of its own; the card only grows downwards, so it
 * does not jump sideways under the pointer when the item arrives.
 *
 * Its number copies itself and the icon beside it copies the item's address, as in a card's
 * head and with the head's words. Beyond those it draws what it is given. Where it floats, when
 * it opens and what a screen reader hears belong to the reference that shows it: the facts are
 * hidden from assistive technology, which hears them as the reference's description
 * (`useWorkItemPreviewWords().describe`), and only the two controls and what they did are read.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { drawMarks } from '@/entities/work-item/components/drawMarks.ts'
import IdentityNote from '@/entities/work-item/components/IdentityNote.vue'
import WorkItemCopyButtons from '@/entities/work-item/components/WorkItemCopyButtons.vue'
import { useWorkItemCopy } from '@/entities/work-item/composables/useWorkItemCopy.ts'
import { useWorkItemPreviewWords } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'
import type { WorkItemPreviewSubject } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'

import SemanticState from '@/shared/ui/SemanticState.vue'
import { SlashBreaks } from '@/shared/ui/SlashBreaks.ts'

const props = withDefaults(defineProps<WorkItemPreviewSubject>(), {
  failure: null,
  waitingOn: null,
  project: null,
})

const { t } = useI18n()
const preview = useWorkItemPreviewWords()

const head = computed(() => (props.item ? preview.headMarks(props, props.item) : []))
const facts = computed(() => (props.item ? preview.factMarks(props, props.item) : []))
const stale = computed(() => (props.item ? preview.staleClaim(props.item) : false))
const when = computed(() => (props.item ? preview.when(props.item) : null))
/** What the card holds: the item, or why there is none yet. */
const read = computed(() => (props.item ? 'item' : (props.failure ?? 'loading')))
const note = computed(() => preview.note(props))
const copied = useWorkItemCopy(() => props.reference)
</script>

<template>
  <div
    class="work-item-preview"
    :data-read="read"
  >
    <p class="preview-head">
      <span class="preview-reference">
        <WorkItemCopyButtons
          :reference="reference"
          :copy-link="copied.copyLink"
          :copy-reference="copied.copyReference"
        />
      </span>
      <span
        v-if="head.length"
        class="preview-head-marks"
        aria-hidden="true"
      >
        <component :is="drawMarks(head, { surface: 'preview', words: preview.words })" />
      </span>
      <IdentityNote
        :text="copied.note.value"
        :failed="copied.failed.value"
      />
    </p>
    <template v-if="item">
      <p
        class="preview-title"
        aria-hidden="true"
      >
        <SlashBreaks :text="item.title" />
      </p>
      <p
        v-if="facts.length || stale"
        class="preview-facts"
        aria-hidden="true"
      >
        <component
          :is="drawMarks(facts, { surface: 'preview', words: preview.words })"
          v-if="facts.length"
        />
        <SemanticState
          v-if="stale"
          dimension="claim-lease"
          state="stale"
          :label="t('workItem.lease.mark')"
        />
      </p>
      <p
        v-if="when"
        class="preview-when"
        aria-hidden="true"
      >
        <template v-if="project"
          ><span class="preview-project">{{ project }}</span> ·
        </template>
        <time :datetime="when.iso">{{ when.text }}</time>
      </p>
    </template>
    <p
      v-else
      class="preview-note"
      aria-hidden="true"
    >
      {{ note }}
    </p>
  </div>
</template>

<style scoped>
/* The surface it floats on is the reference's to draw; the card sets its own
   lines in the tooltip's ink. Every line but the title is one muted step down,
   which on the tooltip's ground still reads at 4.5:1; the tertiary ink a tile
   uses for its reference would not. */
.work-item-preview {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.preview-head,
.preview-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-3);
  align-items: center;
  min-width: 0;
  margin: 0;
}

.preview-reference {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

/* Hidden as one from assistive technology, and laid out as what it holds. */
.preview-head-marks {
  display: contents;
}

/* The whole title, however long: the card is where it is read in full. A title
   of 200 characters with no space in it breaks wherever it has to rather than
   widening the card. */
.preview-title {
  margin: 0;
  color: var(--color-tooltip-text);
  font: var(--font-row-title);
  overflow-wrap: anywhere;
}

.preview-when,
.preview-note {
  margin: 0;
  overflow-wrap: anywhere;
}

.preview-project {
  overflow-wrap: anywhere;
}
</style>
