<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RelatedWorkPicker from '@/widgets/work-item-inspector/components/RelatedWorkPicker.vue'

import { linkWorkItems, planningRefusal } from '@/shared/api/planningApi.ts'
import { LINK_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import type { RichInline } from '@/shared/lib/richText.ts'
import { sourceDocument } from '@/shared/lib/textReferences.ts'
import RichInlines from '@/shared/ui/RichInlines.vue'
import RichText from '@/shared/ui/RichText.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  item: WorkItem
  writable: boolean
}>()
const emit = defineEmits<{
  changed: []
  open: [reference: string]
  session: [id: string, family: string]
}>()
const { t, d } = useI18n()
type Link = WorkItem['links'][number]

/**
 * Kinds whose two directions mean the same thing. A link is stored once, from
 * the item its author was looking at, so "relates to" arrived as two groups
 * under one heading each — the same words twice, the rows split by an accident
 * of who wrote them.
 */
const SYMMETRIC: ReadonlySet<Link['kind']> = new Set(['relates-to'])

const pickerOpen = ref(false)
const busy = ref(false)
const error = ref('')
const groups = computed(() =>
  LINK_KINDS.flatMap((kind) => {
    const directions = SYMMETRIC.has(kind)
      ? [{ key: kind, label: t(`workItem.relation.${kind}.outgoing`), match: () => true }]
      : (['outgoing', 'incoming'] as const).map((direction) => ({
          key: `${kind}-${direction}`,
          label: t(`workItem.relation.${kind}.${direction}`),
          match: (link: Link) => link.direction === direction,
        }))
    return directions
      .map((group) => ({
        key: group.key,
        label: group.label,
        links: props.item.links.filter((link) => link.kind === kind && group.match(link)),
      }))
      .filter((group) => group.links.length)
  }),
)
function add() {
  if (!props.writable || busy.value) return
  pickerOpen.value = true
}
async function remove(link: Link) {
  if (!props.writable || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await linkWorkItems({
      id: link.direction === 'incoming' ? link.work_item_id : props.item.work_item_id,
      other: link.direction === 'incoming' ? props.item.work_item_id : link.work_item_id,
      kind: link.kind,
      remove: true,
    })
    emit('changed')
  } catch (error_) {
    error.value =
      planningRefusal(error_)?.message ??
      (error_ instanceof Error ? error_.message : String(error_))
  } finally {
    busy.value = false
  }
}
/**
 * The plan anchor is one of the item's references, so its whole path stands
 * here with them, a link of the card's own layer; the head offers it only as an
 * icon. It is drawn as written rather than parsed, because Markdown would read a
 * backslash or an underscore in a path as its own. A value that holds no path is text.
 */
const sourceNodes = computed<RichInline[]>(() => {
  const reference = sourceDocument(props.item.source)
  return reference
    ? [{ kind: 'reference', code: false, reference }]
    : [{ kind: 'text', text: props.item.source }]
})

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
</script>

<template>
  <div class="relations">
    <section class="relation-section">
      <SectionHeader
        :title="t('workItem.links')"
        :count="item.links.length || ''"
      >
        <template
          v-if="writable"
          #actions
        >
          <VButton
            variant="ghost"
            :disabled="busy"
            @click="add"
          >
            <VIcon
              name="plus"
              :size="16"
            />
            {{ t('workItem.related.add') }}
          </VButton>
        </template>
      </SectionHeader>
      <p
        v-if="error"
        class="relation-error"
        role="alert"
      >
        {{ error }}
      </p>
      <section
        v-for="group in groups"
        :key="group.key"
        class="relation-group"
      >
        <h4 class="group-heading">
          {{ group.label }}
          <span class="group-count">{{ group.links.length }}</span>
        </h4>
        <ul class="link-list">
          <li
            v-for="link in group.links"
            :key="`${link.direction}-${link.work_item_id}`"
            class="link-row"
          >
            <button
              class="link-open"
              type="button"
              @click="emit('open', link.reference)"
            >
              <span class="link-reference">{{ link.reference }}</span>
              <span class="link-body">
                <span class="link-title">{{ link.title }}</span>
                <!-- The other end's state, when the server could say it: a finished blocker reads as finished. -->
                <SemanticState
                  v-if="link.state_category && link.state_name"
                  variant="inline"
                  dimension="work-item-state"
                  :state="link.state_category"
                  :label="link.state_name"
                />
              </span>
            </button>
            <VButton
              v-if="writable"
              class="link-remove"
              variant="ghost"
              size="inline"
              :disabled="busy"
              :title="t('workItem.unlink')"
              :aria-label="t('workItem.related.remove', { reference: link.reference })"
              icon
              @click="remove(link)"
            >
              <VIcon
                name="close"
                :size="16"
              />
            </VButton>
          </li>
        </ul>
      </section>
      <p
        v-if="!groups.length"
        class="quiet"
      >
        {{ t('workItem.noLinks') }}
      </p>
      <RelatedWorkPicker
        :key="item.work_item_id"
        initial-kind="relates-to"
        initial-direction="outgoing"
        :item="item"
        :writable="writable"
        :open="pickerOpen"
        @close="pickerOpen = false"
        @changed="emit('changed')"
        @open="emit('open', $event)"
      />
    </section>

    <section class="relation-section">
      <SectionHeader
        :title="t('workItem.refs')"
        :count="item.refs.length || ''"
      />
      <p class="quiet">{{ t('workItem.refsIntro') }}</p>
      <ul
        v-if="item.refs.length || item.source"
        class="ref-list"
      >
        <li
          v-if="item.source"
          class="ref-row"
        >
          <span class="ref-kind">{{ t('workItem.source') }}</span>
          <span class="ref-value"><RichInlines :nodes="sourceNodes" /></span>
        </li>
        <li
          v-for="reference in item.refs"
          :key="`${reference.kind}-${reference.value}-${reference.at}`"
          class="ref-row"
        >
          <span class="ref-kind">{{ t(`reference.${reference.kind}`) }}</span>
          <button
            v-if="reference.kind === 'session'"
            type="button"
            class="ref-value"
            @click="emit('session', reference.value, '')"
          >
            {{ reference.label || reference.value }}</button
          ><RichText
            v-else
            class="ref-value"
            :source="reference.label || reference.value"
            inline
          />
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
  gap: var(--space-section);
}

.relation-section {
  display: grid;
  gap: var(--space-heading-content);
}

.quiet {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* A group is a caption over its rows, and the rows hang directly under it:
   the caption and its count are one line of the same quiet type. */
.relation-group {
  display: grid;
  gap: var(--space-1);
}

.group-heading {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-group-heading);
}

.group-count {
  font-variant-numeric: tabular-nums;
}

.relation-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

.link-list {
  display: grid;
  padding: 0;
  margin: 0;
  list-style: none;
}

/* The row and its one action in two columns, so every remove stands at the
   same edge instead of wherever the title happened to end. */
.link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: start;
}

/* The reference column holds an ordinary reference at full width, so titles
   start on one line down the list; a longer key widens only its own row. */
.link-open {
  display: grid;
  grid-template-columns: minmax(8ch, max-content) minmax(0, 1fr);
  gap: var(--space-2);
  align-items: baseline;
  min-width: 0;
  padding: var(--space-1) 0;
  border: 0;
  color: inherit;
  text-align: start;
  background: none;
  cursor: pointer;
}

.link-reference {
  color: var(--color-text-muted);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.link-body {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  align-items: baseline;
  min-width: 0;
}

.link-title {
  color: var(--color-text);
  font: var(--font-note);
  overflow-wrap: anywhere;

  .link-open:is(:hover, :focus-visible) & {
    text-decoration: underline;
  }
}

.ref-list {
  display: grid;
  gap: var(--space-3);
  padding: 0;
  margin: 0;
  list-style: none;
}

.ref-row {
  display: grid;
  gap: var(--space-label-value);
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
</style>
