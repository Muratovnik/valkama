<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RelatedWorkPicker from '@/widgets/work-item-inspector/components/RelatedWorkPicker.vue'

import { linkWorkItems } from '@/shared/api/planningApi.ts'
import { LINK_KINDS } from '@/shared/api/planningModel.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'
import { actorName } from '@/shared/lib/actor.ts'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{ item: WorkItem; writable: boolean }>()
const emit = defineEmits<{
  changed: []
  open: [reference: string]
  session: [id: string, family: string]
}>()
const { t, d } = useI18n()
type Link = WorkItem['links'][number]
const pickerOpen = ref(false)
const initialKind = ref<Link['kind']>('relates-to')
const initialDirection = ref<Link['direction']>('outgoing')
const busy = ref(false)
const error = ref('')
const grouped = computed(() =>
  LINK_KINDS.flatMap((kind) =>
    (['outgoing', 'incoming'] as const)
      .map((direction) => ({
        kind,
        direction,
        links: props.item.links.filter(
          (link) => link.kind === kind && link.direction === direction,
        ),
      }))
      .filter((group) => group.links.length),
  ),
)
function add(kind: Link['kind'] = 'relates-to', direction: Link['direction'] = 'outgoing') {
  if (!props.writable || busy.value) return
  initialKind.value = kind
  initialDirection.value = direction
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
    error.value = error_ instanceof Error ? error_.message : String(error_)
  } finally {
    busy.value = false
  }
}
function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : d(date, 'activity')
}
</script>

<template>
  <div class="relations">
    <section class="relation-section">
      <header class="relations-heading">
        <SectionHeading
          as="h3"
          level="panel"
          >{{ t('workItem.links') }}
          <span class="relation-count">{{ item.links.length }}</span></SectionHeading
        >
        <VButton
          v-if="writable"
          variant="ghost"
          :disabled="busy"
          :title="t('workItem.related.add')"
          :aria-label="t('workItem.related.add')"
          @click="add()"
          >+</VButton
        >
      </header>
      <p
        v-if="error"
        class="relation-error"
        role="alert"
      >
        {{ error }}
      </p>
      <section
        v-for="group in grouped"
        :key="group.kind + group.direction"
        class="relation-group"
      >
        <header class="relations-heading">
          <h4 class="group-heading">
            {{ t(`workItem.relation.${group.kind}.${group.direction}`) }}
            <span class="relation-count">{{ group.links.length }}</span>
          </h4>
          <VButton
            v-if="writable"
            variant="ghost"
            :disabled="busy"
            :title="t('workItem.related.add')"
            :aria-label="`${t('workItem.related.add')}: ${t(
              `workItem.relation.${group.kind}.${group.direction}`,
            )}`"
            @click="add(group.kind, group.direction)"
            >+</VButton
          >
        </header>
        <ul class="link-list">
          <li
            v-for="link in group.links"
            :key="link.work_item_id"
            class="link-row"
          >
            <button
              class="link-open"
              type="button"
              @click="emit('open', link.reference)"
            >
              <span class="link-reference">{{ link.reference }}</span
              ><span class="link-title">{{ link.title }}</span>
            </button>
            <button
              v-if="writable"
              class="link-remove"
              type="button"
              :disabled="busy"
              :aria-label="t('workItem.related.remove', { reference: link.reference })"
              @click="remove(link)"
            >
              {{ t('workItem.unlink') }}
            </button>
          </li>
        </ul>
      </section>
      <p
        v-if="!grouped.length"
        class="quiet"
      >
        {{ t('workItem.noLinks') }}
      </p>
      <RelatedWorkPicker
        :key="item.work_item_id"
        :item="item"
        :writable="writable"
        :open="pickerOpen"
        :initial-kind="initialKind"
        :initial-direction="initialDirection"
        @close="pickerOpen = false"
        @changed="emit('changed')"
        @open="emit('open', $event)"
      />
    </section>

    <section class="relation-section">
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
          <button
            v-if="reference.kind === 'session'"
            type="button"
            class="ref-value"
            @click="emit('session', reference.value, '')"
          >
            {{ reference.label || reference.value }}</button
          ><span
            v-else
            class="ref-value"
            >{{ reference.label || reference.value }}</span
          >
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

.relations-heading {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  align-items: center;
}

.relation-count {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.relation-group {
  display: grid;
  gap: var(--space-2);
}

.group-heading {
  margin: 0;
  color: var(--color-text-tertiary);
  font: var(--font-control);
}

.relation-error {
  margin: 0;
  color: var(--color-danger);
  font: var(--font-detail);
}

.link-list {
  display: grid;
  gap: var(--space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: baseline;
}

.link-open {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  min-width: 0;
  min-height: var(--size-control-target);
  padding: 0;
  border: 0;
  text-align: start;
  background: none;
  cursor: pointer;
}

.link-reference {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font: var(--font-line);
  font-variant-numeric: tabular-nums;
}

.link-title {
  color: var(--color-text);
  font: var(--font-editor);
  overflow-wrap: anywhere;
}

.link-remove {
  min-height: var(--size-control-target);
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

.link-open:is(:hover, :focus-visible) .link-title {
  text-decoration: underline;
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
