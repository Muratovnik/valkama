<script setup lang="ts">
/**
 * Every mapped project's work, searched from anywhere, a result opened by Enter.
 *
 * A result row prints the facets the registry gives the finder: the priority
 * when it asks for attention, the kind when it is not a plain task, the
 * reference, the title, then the state's dot and name and the project. The
 * marks are read, not pressed: a row opens its item, and the finder filters
 * nothing. A result from a server that does not send them reads as before.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import type { FacetSubject } from '@/entities/work-item/utils/facets.ts'

import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import type { GlobalPlanningSearch } from '@/shared/api/planningGlobalSearchApi.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { skippedSourceReason } from '@/shared/api/planningTarget.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'
import { projectTitle } from '@/shared/lib/projectTitles.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import CommandList from '@/shared/ui/CommandList.vue'
import DialogFrame from '@/shared/ui/DialogFrame.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** The projects the app already lists, so a result can name its project by title. */
    projects?: readonly { project_id: string; title: string }[]
    /** Text to search for as it opens, handed over by another search; blank keeps the last one. */
    text?: string
  }>(),
  { projects: () => [], text: '' },
)
const emit = defineEmits<{ close: []; select: [target: PlanningTarget] }>()
const { t } = useI18n()
const stateName = useStateName()
const query = ref('')
const retry = ref(0)
const loading = ref(false)
/** Why the whole search failed, as a code; null while it has not. */
const failure = ref<string | null>(null)
/** Enter was pressed before the rows arrived: open the first one when they do. */
const pendingOpen = ref(false)
const result = ref<GlobalPlanningSearch | null>(null)
/**
 * The glyph before a result's reference, in a slot of its own so references align. The
 * one reading order puts the kind before the reference and the priority after it, so the
 * priority stands with the state on the line below.
 */
const LEAD = ['kind'] as const

/** A reason line names this many sources and counts the rest. */
const SOURCES_SHOWN = 3
/** The failures that stop every source at once, and the timeout. */
const FAILURES = new Set([
  'project_registry_unavailable',
  'planning_binding_invalid',
  'request_timeout',
])

/**
 * The sources that were not searched, one line per reason. A raw reason never
 * reaches the screen: the shared mapping reads an unknown one as "other".
 */
const skipped = computed(() => {
  const groups = new Map<string, string[]>()
  for (const entry of result.value?.coverage ?? []) {
    if (entry.status !== 'unavailable') continue
    const reason = skippedSourceReason(entry.reason)
    const sources = groups.get(reason) ?? []
    sources.push(`${projectTitle(props.projects, entry.project_id)} · ${entry.space_ref.space_key}`)
    groups.set(reason, sources)
  }
  return [...groups].map(([reason, sources]) => ({
    reason,
    label: t(`finder.reasons.${reason}`),
    // Each source is its own box, so a name moves to the next line whole rather
    // than breaking at its hyphen; the separator rides after it as text.
    sources: sources.slice(0, SOURCES_SHOWN).map((text, index, shown) => ({
      text,
      separator: index < shown.length - 1 ? ', ' : '',
    })),
    // The space is part of the text: a template would condense it away.
    more:
      sources.length > SOURCES_SHOWN
        ? ` ${t('finder.more', { count: sources.length - SOURCES_SHOWN })}`
        : '',
  }))
})
/**
 * A query shaped like a task reference that names no task found here.
 *
 * Its rows are only text that mentions it, and Enter used to open the first of
 * them: a typo in a number silently landed on another task. The finder says the
 * number was not found, lists the mentions under that, and leaves Enter with
 * nothing to open until the reader picks one.
 */
const missingReference = computed(() => {
  const wanted = query.value.trim().toUpperCase()
  if (!result.value || !WORK_ITEM_REFERENCE.test(wanted)) return null
  return result.value.items.some((entry) => entry.item.reference === wanted) ? null : wanted
})
/** The row Enter opens with none highlighted: the first, unless a typed number was not found. */
const opensOnEnter = (response: GlobalPlanningSearch | null) =>
  missingReference.value ? undefined : response?.items[0]
/** The one sentence that says where the search stands, or nothing once rows speak for it. */
const feedback = computed(() => {
  if (loading.value) return t(pendingOpen.value ? 'finder.opening' : 'finder.loading')
  if (failure.value !== null) {
    const known = FAILURES.has(failure.value) ? failure.value : 'request_failed'
    return t(`finder.failures.${known}`)
  }
  if (!hasQuery.value) return t('finder.prompt')
  if (missingReference.value) {
    const reference = missingReference.value
    return result.value?.items.length
      ? t('finder.missingWithMatches', { reference })
      : t('finder.missing', { reference })
  }
  if (result.value && !result.value.items.length)
    return t(skipped.value.length ? 'finder.partialEmpty' : 'finder.empty')
  return ''
})
const truncated = computed(() => !loading.value && Boolean(result.value?.has_more))
const hasQuery = computed(() => Boolean(query.value.trim()))
type Found = GlobalPlanningSearch['items'][number]

/** What the registry can print for a result: its kind, priority and state, when the server sent them. */
function subjectOf({ item }: Found): FacetSubject | null {
  const { kind, priority, state } = item
  return kind && priority && state.category
    ? { kind, priority, state: { ...state, category: state.category } }
    : null
}

const choices = computed(() =>
  (result.value?.items ?? []).map((entry) => {
    const subject = subjectOf(entry)
    const project = projectTitle(props.projects, entry.target.project_id)
    const readonly = entry.target.writable ? [] : [t('finder.readonly')]
    return {
      key: `${entry.target.project_id}:${entry.target.space_ref.data_scope_id}:${entry.item.work_item_id}`,
      title: entry.item.title,
      reference: entry.item.reference,
      subject,
      // With its marks the state is drawn, so the words after it are the rest.
      place: [project, ...readonly].join(' · '),
      detail: [project, stateName(entry.item.state), ...readonly].join(' · '),
    }
  }),
)

function selectKey(key: string) {
  const index = choices.value.findIndex((entry) => entry.key === key)
  const entry = result.value?.items[index]
  if (entry) select(entry.target)
}

/** Enter with no row highlighted opens the first one, now or once it arrives. */
function submit() {
  if (loading.value) {
    pendingOpen.value = true
    return
  }
  const first = opensOnEnter(result.value)
  if (first) select(first.target)
}

// Declared ahead of the search, so the search that opening starts is already for this text.
watch(
  [() => props.open, () => props.text],
  ([open, text]) => {
    if (open && text) query.value = text
  },
  { immediate: true, flush: 'sync' },
)

watch(
  [query, () => props.open, retry],
  ([text, open], _previous, cleanup) => {
    result.value = null
    failure.value = null
    loading.value = false
    pendingOpen.value = false
    if (!open || !text.trim()) return
    const controller = new AbortController()
    let current = true
    loading.value = true
    const timer = setTimeout(() => {
      void searchGlobalPlanningWorkItems(text.trim(), controller.signal)
        .then((response) => {
          if (!current) return
          result.value = response
          loading.value = false
          const first = opensOnEnter(response)
          if (pendingOpen.value && first) select(first.target)
        })
        .catch((error: unknown) => {
          if (current) failure.value = typedFailure(error).code
        })
        .finally(() => {
          if (!current) return
          loading.value = false
          pendingOpen.value = false
        })
    }, 250)
    cleanup(() => {
      current = false
      clearTimeout(timer)
      controller.abort()
    })
  },
  { immediate: true, flush: 'sync' },
)

function select(target: PlanningTarget) {
  if (!props.open || loading.value) return
  emit('select', target)
}
</script>

<template>
  <DialogFrame
    placement="top"
    :open="open"
    :title="t('finder.title')"
    :subtitle="t('finder.scope')"
    :close-label="t('finder.close')"
    @close="emit('close')"
  >
    <CommandList
      v-if="open"
      v-model:query="query"
      :label="t('finder.searchLabel')"
      :placeholder="t('finder.placeholder')"
      :results-label="t('finder.results')"
      :items="choices"
      :loading="loading"
      :highlight-first="!missingReference"
      @select="selectKey"
      @submit="submit"
    >
      <template #lead="{ item }">
        <template v-if="item.subject">
          <FacetMarks
            v-for="facet in LEAD"
            :key="facet"
            class="finder-slot"
            surface="finder"
            :item="item.subject"
            :facets="[facet]"
            lead
          />
        </template>
      </template>
      <template #detail="{ item }">
        <template v-if="item.subject"
          ><FacetMarks
            surface="finder"
            :item="item.subject"
            :facets="['priority', 'state']"
          /><span aria-hidden="true"> · </span>{{ item.place }}</template
        >
        <template v-else>{{ item.detail }}</template>
      </template>
      <template #feedback>
        <div
          class="finder-feedback"
          role="status"
          aria-live="polite"
        >
          <p v-if="feedback">{{ feedback }}</p>
          <div
            v-if="!loading && skipped.length"
            class="finder-skipped"
          >
            <SemanticState
              dimension="platform-ui-state"
              state="degraded"
              :label="t('finder.partial')"
            />
            <ul class="finder-skipped-list">
              <li
                v-for="group in skipped"
                :key="group.reason"
                class="finder-skipped-line"
              >
                {{ group.label }}:
                <template
                  v-for="source in group.sources"
                  :key="source.text"
                  ><span class="finder-skipped-source">{{ source.text }}</span
                  >{{ source.separator }}</template
                >{{ group.more }}
              </li>
            </ul>
          </div>
          <p v-if="truncated">{{ t('finder.truncated') }}</p>
        </div>
        <VButton
          v-if="failure"
          class="finder-retry"
          variant="secondary"
          @click="retry++"
          >{{ t('finder.retry') }}</VButton
        >
      </template>
    </CommandList>
    <p class="finder-keyboard">{{ t('finder.keyboard') }}</p>
  </DialogFrame>
</template>

<style scoped>
.finder-feedback {
  display: grid;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);

  &:empty {
    display: none;
  }
}

.finder-skipped {
  display: grid;
  gap: var(--space-1);
}

.finder-skipped-list {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  margin: 0;
  list-style: none;
}

.finder-skipped-line {
  overflow-wrap: anywhere;
}

.finder-skipped-source {
  display: inline-block;
  max-width: 100%;
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.finder-retry {
  justify-self: start;
}

/* A slot holds its glyph or nothing, and is as wide either way. */
.finder-slot {
  justify-content: center;
  inline-size: var(--space-4);
}

.finder-keyboard {
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
}
</style>
