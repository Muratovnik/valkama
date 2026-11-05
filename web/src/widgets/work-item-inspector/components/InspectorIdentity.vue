<script setup lang="ts">
/**
 * Who the item is, in one quiet line over its title: its kind in a glyph and a
 * word, its reference, when it last changed, and its plan anchor as an icon.
 *
 * These are what a reader checks once and then reads past, so they take the
 * tertiary ink and none of them is a row of its own. They used to be: the
 * reference under the title, «Обновлено» and «Источник» as two cells of a fact
 * grid below the writes, which put the state half way down the drawer.
 *
 * The reference copies itself, and the link beside it copies the item's short
 * address, `/open/<number>` on this origin, which opens the card wherever it is
 * followed: the desktop app has no address bar to take it from. Each says what
 * happened at the end of the line, by the one rule `IdentityNote` keeps for both.
 * The note for the link names no number: the reference stands right before it.
 *
 * Nothing on the line is ever cut: a date shortened to «04 нояб.,…» is no date.
 * Short of room, things step aside whole, in this order: the date, which stands in
 * the record's history; then the item's kind and the plan anchor, whose path stands
 * in Relations too; and last the note's words, whose glyph stays. Each is measured,
 * never assumed. A note says what a press just did and goes after a few seconds, and
 * what stepped aside for it comes back.
 *
 * The anchor is a path like any other in the card, so the document layer decides
 * what it does: open what the server confirmed, or copy it and say why, as the
 * opener says everything. Its whole path stands in Relations with the item's other
 * references, whose layer this line is outside of, so it asks for its own.
 */
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useResizeObserver, useTimeoutFn } from '@vueuse/core'

import IdentityNote from '@/widgets/work-item-inspector/components/IdentityNote.vue'

import { useDocumentLinks } from '@/entities/project-document/documentLinks.ts'
import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { workItemLinkAddress } from '@/shared/api/platformRoute.ts'
import { sourceDocument } from '@/shared/lib/textReferences.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** Null when the record could not be read: the line holds the reference alone. */
  item: WorkItem | null
  reference: string
  resourceRef: PlanningSpaceEntityRef
}>()

const { t, d } = useI18n()

const documents = useDocumentLinks(() => ({ space: props.resourceRef.resource_id }))
/** What the anchor does; none where `source` holds no path, which Relations shows as text. */
const sourceLink = computed(() => {
  const reference = sourceDocument(props.item?.source ?? '')
  return reference && documents(reference)
})
/** Absent rather than false: a control that is not waiting makes no claim about it. */
const sourceBusy = computed(() => sourceLink.value?.busy || undefined)
/** Told apart by shape, as a link that copies is by its dotted underline; a wait claims neither. */
const sourceGlyph = computed(() =>
  sourceLink.value?.copies && !sourceLink.value.busy ? 'copy' : 'document',
)
const copyNote = ref('')
const copyFailed = ref(false)
/** Long enough to read the longest note twice; then the line is the item's again. */
const NOTE_SHOWN_MS = 5000
const { start: expireNote } = useTimeoutFn(
  () => {
    copyNote.value = ''
  },
  NOTE_SHOWN_MS,
  { immediate: false },
)

/** Put `text` on the clipboard and say beside the line whether it got there. */
async function copy(text: string, done: string, failed: string) {
  const words = { reference: props.reference }
  try {
    await navigator.clipboard.writeText(text)
    copyFailed.value = false
    copyNote.value = t(done, words)
  } catch {
    copyFailed.value = true
    copyNote.value = t(failed, words)
  }
  expireNote()
}

const copyReference = () =>
  copy(props.reference, 'workItem.head.referenceCopied', 'workItem.head.referenceCopyFailed')
const copyLink = () =>
  copy(
    workItemLinkAddress(location.origin, props.reference),
    'workItem.head.linkCopied',
    'workItem.head.linkCopyFailed',
  )

function pressSource() {
  copyNote.value = ''
  sourceLink.value?.open()
}

const line = useTemplateRef<HTMLElement>('line')
/** How much has stepped aside: nothing, the date, then the kind, the anchor, the note's words. */
const yielded = ref(0)

/** Give back everything, then take out one thing at a time while the line overflows. */
async function fit() {
  yielded.value = 0
  await nextTick()
  const box = line.value
  while (box && box.scrollWidth > box.clientWidth && yielded.value < 4) {
    yielded.value += 1
    await nextTick()
  }
}

const dateShown = computed(() => yielded.value < 1)
const kindShown = computed(() => yielded.value < 2)
const anchorShown = computed(() => yielded.value < 3)
const noteWords = computed(() => yielded.value < 4)

// Anything that can arrive after the line was fitted: a note, the anchor once its path
// is read, the date and the kind once the item is.
watch([copyNote, () => Boolean(sourceLink.value), () => props.item?.updated_at], fit, {
  flush: 'post',
})
// The line's width is the drawer's and never its own content's, so what steps aside
// does not move the width this watches.
useResizeObserver(line, () => void fit())

/** This year's dates without the year, as the board's own dates read. */
const updated = computed(() => {
  const value = props.item?.updated_at
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return d(date, date.getFullYear() === new Date().getFullYear() ? 'day' : 'activity')
})
</script>

<template>
  <div
    ref="line"
    class="card-identity"
  >
    <span
      v-if="item && kindShown"
      class="identity-fact identity-kind"
    >
      <FacetMarks
        surface="card"
        :item="item"
        :facets="['kind']"
      />
    </span>
    <span class="identity-fact">
      <button
        class="head-reference"
        type="button"
        :title="t('workItem.head.copyReference', { reference })"
        :aria-label="t('workItem.head.copyReference', { reference })"
        @click="copyReference"
      >
        {{ reference }}
      </button>
      <button
        class="identity-link"
        type="button"
        :title="t('workItem.head.copyLink', { reference })"
        :aria-label="t('workItem.head.copyLink', { reference })"
        @click="copyLink"
      >
        <VIcon
          name="link"
          :size="14"
        />
      </button>
    </span>
    <span
      v-if="updated && dateShown"
      class="identity-fact identity-updated"
      >{{ t('workItem.head.updated', { date: updated }) }}</span
    >
    <button
      v-if="sourceLink && anchorShown"
      class="identity-source"
      type="button"
      :title="sourceLink.title"
      :aria-label="sourceLink.title"
      :aria-busy="sourceBusy"
      @click="pressSource"
    >
      <VIcon
        :name="sourceGlyph"
        :size="14"
      />
    </button>
    <IdentityNote
      :text="copyNote"
      :failed="copyFailed"
      :words="noteWords"
    />
  </div>
</template>

<style scoped>
/* One line of small facts, in a bar that has one height: nothing shortens, and what does
   not fit steps aside whole (the script says in which order). The middle dot between two of them
   belongs to the second one's box and not to a control inside it, so a focus ring holds
   only the reference, and a fact that is absent leaves no stray dot behind. */
.card-identity {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  white-space: nowrap;
}

.identity-fact {
  display: inline-flex;
  flex: none;
  align-items: center;
}

/* A bare date is a text box of its own, trimmed to the letters as the state's label is, so the
   plan anchor's icon centres on the same middle as the reference beside it. */
.identity-updated {
  display: block;
  text-box: trim-both ex alphabetic;
}

.identity-fact + .identity-fact::before {
  content: '·';
  margin-inline-end: var(--space-2);
}

.head-reference,
.identity-link,
.identity-source {
  display: inline-flex;
  align-items: center;
  min-block-size: var(--size-control-inline);
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  background: none;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.head-reference {
  font-family: var(--font-family-mono);
  font-variant-numeric: tabular-nums;
}

.identity-link,
.identity-source {
  flex: none;
  justify-content: center;
  min-inline-size: var(--size-control-inline);
}

/* The link belongs to the reference it copies, a step apart so the two rings never touch. */
.identity-link {
  margin-inline-start: var(--space-1);
}

/* A phone-wide drawer keeps who the item is and leaves when it changed to the
   record's history. */
@container drawer (width < 520px) {
  .identity-updated {
    display: none;
  }
}
</style>
