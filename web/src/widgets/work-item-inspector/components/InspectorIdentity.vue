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
 * The reference copies itself and the link beside it copies the item's address
 * (`useWorkItemCopy`). Each says what happened at the end of the line, by the one rule
 * `IdentityNote` keeps for both. The note for the link names no number: the reference
 * stands right before it. Where the item can be pinned the pin stands after the link
 * (`InspectorPin`), and never steps aside: it is an action, not a fact.
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

import { useResizeObserver } from '@vueuse/core'

import InspectorPin from '@/widgets/work-item-inspector/components/InspectorPin.vue'

import { useDocumentLinks } from '@/entities/project-document/documentLinks.ts'
import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import IdentityNote from '@/entities/work-item/components/IdentityNote.vue'
import WorkItemCopyButtons from '@/entities/work-item/components/WorkItemCopyButtons.vue'
import { useWorkItemCopy } from '@/entities/work-item/composables/useWorkItemCopy.ts'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { sourceDocument } from '@/shared/lib/textReferences.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** Null when the record could not be read: the line holds the reference alone. */
  item: WorkItem | null
  reference: string
  resourceRef: PlanningSpaceEntityRef
  /** The item is in the primary store, whose items a person can pin. */
  pinnable?: boolean
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
const {
  copyLink,
  copyReference,
  failed: copyFailed,
  note: copyNote,
} = useWorkItemCopy(() => props.reference)

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
      <WorkItemCopyButtons
        :reference="reference"
        :copy-link="copyLink"
        :copy-reference="copyReference"
      />
      <InspectorPin
        v-if="pinnable"
        :reference="reference"
      />
    </span>
    <span
      v-if="updated && dateShown"
      class="identity-fact identity-updated trimmed-word"
      >{{ t('workItem.head.updated', { date: updated }) }}</span
    >
    <button
      v-if="sourceLink && anchorShown"
      v-tooltip="sourceLink.title"
      class="identity-source"
      type="button"
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
}

.identity-fact + .identity-fact::before {
  content: '·';
  margin-inline-end: var(--space-2);
}

.identity-source {
  display: inline-flex;
  flex: none;
  justify-content: center;
  align-items: center;
  min-inline-size: var(--size-control-inline);
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
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

/* A phone-wide drawer keeps who the item is and leaves when it changed to the
   record's history. */
@container drawer (width < 520px) {
  .identity-updated {
    display: none;
  }
}
</style>
