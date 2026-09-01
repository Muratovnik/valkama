<script setup lang="ts">
/**
 * How this item stands to the others, and what it points at outside Valkama.
 *
 * A link is directional and the direction is the whole meaning: `blocks`
 * outgoing is work this item holds up, `blocks` incoming is work holding this
 * one up. The Board era grouped them into four named buckets, which is the same
 * four facts spelled twice; here the kind and the direction pick the phrase.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { LINK_KINDS, WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  item: WorkItem
  writable: boolean
}>()

const emit = defineEmits<{
  link: [value: { kind: string; other: string }]
  open: [reference: string]
  unlink: [value: { kind: string; other: string }]
}>()

const { t, d } = useI18n()

const linkKind = ref<string>('blocks')
const linkOther = ref('')

const kindOptions = computed(() =>
  LINK_KINDS.map((kind) => ({ value: kind, label: t(`workItem.link.${kind}`) })),
)

/**
 * A reference typed by hand is checked against the shape the server accepts
 * before the request, so a typo answers immediately instead of as a refusal.
 */
const linkable = computed(
  () => props.writable && WORK_ITEM_REFERENCE.test(linkOther.value.trim().toUpperCase()),
)

const grouped = computed(() => {
  const order = new Map(LINK_KINDS.map((kind, index) => [kind, index]))
  return [...props.item.links].sort(
    (left, right) =>
      (order.get(left.kind) ?? 0) - (order.get(right.kind) ?? 0) ||
      left.direction.localeCompare(right.direction) ||
      left.reference.localeCompare(right.reference),
  )
})

function phrase(link: WorkItem['links'][number]): string {
  return t(`workItem.relation.${link.kind}.${link.direction}`)
}

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}

function addLink() {
  if (!linkable.value) return
  emit('link', { other: linkOther.value.trim().toUpperCase(), kind: linkKind.value })
  linkOther.value = ''
}
</script>

<template>
  <div class="relations">
    <section>
      <SectionHeading
        as="h3"
        level="panel"
        >{{ t('workItem.links') }}</SectionHeading
      >
      <ul
        v-if="grouped.length"
        class="link-list"
      >
        <li
          v-for="link in grouped"
          :key="`${link.kind}-${link.direction}-${link.work_item_id}`"
          class="link-row"
        >
          <span class="link-phrase">{{ phrase(link) }}</span>
          <button
            class="link-open"
            type="button"
            @click="emit('open', link.reference)"
          >
            <span class="link-reference">{{ link.reference }}</span>
            <span class="link-title">{{ link.title }}</span>
          </button>
          <button
            v-if="writable"
            class="link-remove"
            type="button"
            :title="t('workItem.unlink')"
            @click="emit('unlink', { other: link.reference, kind: link.kind })"
          >
            {{ t('workItem.unlink') }}
          </button>
        </li>
      </ul>
      <p
        v-else
        class="quiet"
      >
        {{ t('workItem.noLinks') }}
      </p>

      <form
        v-if="writable"
        class="link-form"
        @submit.prevent="addLink"
      >
        <ChoiceSelect
          v-model="linkKind"
          :label="t('workItem.linkKind')"
          :options="kindOptions"
        />
        <VTextInput
          v-model="linkOther"
          :label="t('workItem.linkOther')"
          :hint="t('workItem.linkOtherHint')"
          :maxlength="20"
        />
        <VButton
          type="submit"
          :disabled="!linkable"
        >
          {{ t('workItem.linkAdd') }}
        </VButton>
      </form>
    </section>

    <section>
      <SectionHeading
        as="h3"
        level="panel"
        >{{ t('workItem.refs') }}</SectionHeading
      >
      <p class="quiet">{{ t('workItem.refsIntro') }}</p>
      <ul
        v-if="item.refs.length"
        class="ref-list"
      >
        <li
          v-for="reference in item.refs"
          :key="`${reference.kind}-${reference.value}-${reference.at}`"
          class="ref-row"
        >
          <span class="ref-kind">{{ t(`reference.${reference.kind}`) }}</span>
          <span class="ref-value">{{ reference.label || reference.value }}</span>
          <span class="ref-meta">{{
            t('workItem.refAttached', {
              author: actorName(reference.author),
              at: when(reference.at),
            })
          }}</span>
        </li>
      </ul>
      <p
        v-else
        class="quiet"
      >
        {{ t('workItem.noRefs') }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.relations {
  display: grid;
  gap: var(--space-5);
}

.quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.link-list {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: var(--space-2) 0 0;
  list-style: none;
}

/* The phrase leads, because "blocked by" is what the reader is looking for; the
   reference and title follow it as one target. */
.link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-hair) var(--space-2);
  align-items: baseline;
}

.link-phrase {
  grid-column: 1 / -1;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.link-open {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  min-width: 0;
  padding: 0;
  border: 0;
  text-align: start;
  background: none;
  cursor: pointer;

  &:is(:hover, :focus-visible) .link-title {
    text-decoration: underline;
  }
}

.link-reference {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
}

.link-title {
  color: var(--color-text);
  font: var(--font-line);
  overflow-wrap: anywhere;
}

.link-remove {
  padding: 0 var(--space-1);
  border: 0;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--color-danger);
  }
}

.link-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: end;
  padding-top: var(--space-3);
}

.ref-list {
  display: grid;
  gap: var(--space-3);
  padding: 0;
  margin: var(--space-2) 0 0;
  list-style: none;
}

.ref-row {
  display: grid;
  gap: var(--space-hair);
  min-width: 0;
}

.ref-kind {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

.ref-value {
  color: var(--color-text);
  font: var(--font-line);
  overflow-wrap: anywhere;
}

.ref-meta {
  color: var(--color-text-tertiary);
  font: var(--font-detail);
}

@container workspace (width <= 586px) {
  .link-form {
    grid-template-columns: minmax(0, 1fr);
    justify-items: start;
  }
}
</style>
