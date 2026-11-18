<script setup lang="ts">
/**
 * A work item as the card a reference in text shows while the pointer rests on
 * it: what the item is and where it stands, without opening it.
 *
 * Its head as every surface reads an item: a kind that is not the ordinary one,
 * the reference, a priority that is not the ordinary one, and its state, with
 * what it waits on if anything does (`MarkHead`);
 * the whole title, wrapped wherever it has to be but never inside a reference it names
 * (`WorkItemTitle`); who holds it and how far its steps are; and when it last changed
 * or closed, after the project it comes from when that is not the open one. Each fact
 * is the facet registry's (`surface: 'preview'`), drawn as a tile draws its own, so a
 * stale claim reads the same here as on the board. A line of facts breaks between words
 * alone, so an id, a session's start or a project's key is never cut across two lines
 * (`vWholeWords`).
 *
 * Until the item is read the reference stands alone with one line under it, which
 * says the wait once it has lasted, and a refusal says so in a line of its own; the
 * card only grows downwards, so it does not jump sideways under the pointer when the
 * item arrives.
 *
 * Its number copies itself and the icon beside it copies the item's address, as in a card's
 * head and with the head's words. Beyond those it draws what it is given. Where it floats, when
 * it opens and what a screen reader hears belong to the reference that shows it: the facts are
 * hidden from assistive technology, which hears them as the reference's description
 * (`useWorkItemPreviewWords().describe`), and only the two controls and what they did are read.
 *
 * Each line carries `data-preview-part`: `head`, `title`, `facts`, `when`, or `note` for the line
 * a card without an item prints.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { drawMarks, MarkHead } from '@/entities/work-item/components/drawMarks.ts'
import IdentityNote from '@/entities/work-item/components/IdentityNote.vue'
import WorkItemCopyButtons from '@/entities/work-item/components/WorkItemCopyButtons.vue'
import WorkItemTitle from '@/entities/work-item/components/WorkItemTitle.vue'
import { useWorkItemCopy } from '@/entities/work-item/composables/useWorkItemCopy.ts'
import { useWorkItemPreviewWords } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'
import type { WorkItemPreviewSubject } from '@/entities/work-item/composables/useWorkItemPreviewWords.ts'

import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vWholeWords } from '@/shared/ui/wholeWords.ts'

const props = withDefaults(defineProps<WorkItemPreviewSubject>(), {
  failure: null,
  waitingOn: null,
  project: null,
})

const { t } = useI18n()
const preview = useWorkItemPreviewWords()

/**
 * The read of an item nothing is known of, said as every wait is (`loadingPresence`):
 * nothing for a read that answers quickly, and once said, long enough to be read, with the
 * item held back meanwhile. The delay counts from the read, which began before the card
 * opened.
 */
const presence = useLoadingPresence(() => !props.item && !props.failure, {
  since: () => props.since ?? undefined,
})
/** The item as the card draws it: none while the wait is held. */
const drawn = computed(() => (presence.held.value ? null : props.item))
const head = computed(() => (drawn.value ? preview.headMarks(props, drawn.value) : []))
const facts = computed(() => (drawn.value ? preview.factMarks(props, drawn.value) : []))
const stale = computed(() => (drawn.value ? preview.staleClaim(drawn.value) : false))
const when = computed(() => (drawn.value ? preview.when(drawn.value) : null))
/** What the card holds: the item, or why there is none yet. */
const read = computed(() => (drawn.value ? 'item' : (props.failure ?? 'loading')))
/** The line under a reference with no item: why there is none, or the wait once it is shown. */
const note = computed(() => {
  if (props.failure) return preview.note(props)
  return presence.shown.value ? preview.note(props) : ''
})
const copied = useWorkItemCopy(() => props.reference)
</script>

<template>
  <div
    class="work-item-preview"
    :data-read="read"
  >
    <p
      class="preview-head"
      data-preview-part="head"
    >
      <MarkHead
        class="preview-head-run"
        :marks="head"
        :run="{ surface: 'preview', unspoken: true, words: preview.words }"
      >
        <span class="preview-reference">
          <WorkItemCopyButtons
            :reference="reference"
            :copy-link="copied.copyLink"
            :copy-reference="copied.copyReference"
          />
        </span>
      </MarkHead>
      <IdentityNote
        :text="copied.note.value"
        :failed="copied.failed.value"
      />
    </p>
    <template v-if="drawn">
      <p
        class="preview-title"
        data-preview-part="title"
        aria-hidden="true"
      >
        <WorkItemTitle :title="drawn.title" />
      </p>
      <p
        v-if="facts.length || stale"
        class="preview-facts"
        data-preview-part="facts"
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
          in-preview
        />
      </p>
      <p
        v-if="when"
        class="preview-when"
        data-preview-part="when"
        aria-hidden="true"
      >
        <template v-if="project"
          ><span
            v-whole-words="project"
            class="preview-project"
          />
          ·
        </template>
        <time :datetime="when.iso">{{ when.text }}</time>
      </p>
    </template>
    <p
      v-else
      class="preview-note"
      data-preview-part="note"
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

/* Its marks are trimmed to their letters, to centre on the state beside them; the
   line stays a line of text tall, as the card's other lines are. Trimmed, it fell to
   the letters' height and took 11px out of a card that then hung over the next
   reference with its own number under the pointer. */
.preview-facts {
  min-block-size: 1lh;
}

.preview-reference {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}

/* The head is laid out as what it holds, on the line with the note after it. */
.preview-head-run {
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

/* A line tall before a wait's word arrives, so the word moves nothing when it does. */
.preview-note {
  min-block-size: 1lh;
}

.preview-project {
  overflow-wrap: anywhere;
}
</style>
