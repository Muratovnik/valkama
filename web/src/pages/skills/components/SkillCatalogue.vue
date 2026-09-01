<script setup lang="ts">
/**
 * The searchable list of skills in the current scope.
 *
 * The pane measures against itself rather than the window — a navigation rail that
 * collapses and a drawer that opens hand the same viewport several widths — which
 * is what the `skills-catalog` container is for.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { filterSkills } from '@/pages/skills/utils/skillFilter.ts'
import {
  readinessState,
  skillPresentation,
  statusOptions,
} from '@/pages/skills/utils/skillPresentation.ts'

import type { SkillEntry } from '@/shared/types/skills.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SelectionControl from '@/shared/ui/SelectionControl.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  query: string
  selectedKey: string
  skills: SkillEntry[]
  status: string
}>()
const emit = defineEmits<{
  choose: [skill: SkillEntry]
  query: [query: string]
  status: [status: string]
}>()

const { t, te, locale } = useI18n()
const { readinessLabel, scopeLabel, skillReason, sourceLabel } = skillPresentation(
  t,
  te,
  () => locale.value,
)

const states = computed(() => statusOptions(t))
const visibleSkills = computed(() =>
  filterSkills(props.skills, props.query, props.status, locale.value),
)

/** Whether this row is the skill the drawer beside the table is showing. */
function isSelected(entry: SkillEntry) {
  return props.selectedKey === entry.key
}

function updateQuery(event: Event) {
  emit('query', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <section
    class="catalog-pane"
    :aria-label="t('skills.catalog')"
  >
    <div class="skills-filters">
      <label class="skill-search">
        <VIcon
          name="search"
          :size="18"
        />
        <input
          class="search-input"
          type="search"
          :value="query"
          :placeholder="t('skills.search')"
          :aria-label="t('skills.search')"
          @input="updateQuery"
        />
      </label>
      <SelectionControl
        :model-value="status"
        :options="states"
        :label="t('skills.statusFilter')"
        @update:model-value="(value) => emit('status', value)"
      />
    </div>
    <!-- No band between the filters and the table. It carried the number of
         visible rows, which is the table underneath it, and the name of the
         current scope, which is the workspace selector in the context bar —
         two restatements and a hairline to hold them. -->
    <div
      class="skill-results"
      data-scalable-list="true"
      role="table"
      :aria-label="t('skills.catalog')"
    >
      <div
        class="skill-table"
        role="rowgroup"
      >
        <div
          class="skill-table-head"
          role="row"
        >
          <span role="columnheader">{{ t('skills.table.skill') }}</span>
          <span role="columnheader">{{ t('skills.table.scope') }}</span>
          <span role="columnheader">{{ t('skills.table.status') }}</span>
        </div>
        <button
          v-for="entry in visibleSkills"
          :key="entry.key"
          type="button"
          role="row"
          class="skill-row"
          :class="[{ selected: isSelected(entry) }]"
          :aria-selected="isSelected(entry)"
          @click="emit('choose', entry)"
        >
          <span
            class="skill-identity"
            role="cell"
            ><strong class="skill-name">{{ entry.name }}</strong
            ><small class="skill-summary">{{
              entry.description || entry.directory_name
            }}</small></span
          >
          <span
            class="skill-scope"
            role="cell"
            ><small class="mobile-column-label">{{ t('skills.table.scope') }}</small
            ><b class="scope-name">{{ scopeLabel(entry) }}</b
            ><small class="scope-source">{{ sourceLabel(entry.source) }}</small></span
          >
          <span
            class="skill-state"
            role="cell"
          >
            <small class="mobile-column-label">{{ t('skills.table.status') }}</small>
            <SemanticState
              dimension="skill-readiness"
              :state="readinessState(entry)"
              :label="readinessLabel(entry)"
            />
            <small
              v-if="skillReason(entry)"
              class="state-reason"
              >{{ skillReason(entry) }}</small
            >
          </span>
        </button>
      </div>
      <DataEmptyState
        v-if="!visibleSkills.length"
        :title="t('skills.emptyTitle')"
        :description="t('skills.emptyBody')"
        compact
      />
    </div>
  </section>
</template>

<style scoped>
.catalog-pane {
  display: grid;
  grid-template-rows: auto auto;
  width: 100%;
  min-width: 0;
  background: var(--color-surface-sheet);
  container: skills-catalog / inline-size;
}

/* Two controls, two columns. The track list declared three and the third was
   never filled, which is why the narrow container queries below it had to spend
   two steps putting the search back across a column that held nothing. */
.skills-filters {
  display: grid;
  grid-template-columns: minmax(210px, 1fr) minmax(190px, 230px);
  gap: var(--space-2);
  padding: var(--space-3);
}

.skill-search {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  height: var(--size-control-height);
  padding: 0 var(--space-3);
  background: var(--color-control-surface);
  border-radius: var(--radius-control);

  .search-input {
    width: 100%;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    color: var(--color-text);
    background: transparent;
    outline: 0;
  }

  &:focus-within {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }
}

.skill-results {
  min-width: 0;
}

.skill-table {
  position: relative;
  min-width: 0;
}

/* One value in a column, one heading above it, and enough air between two
   columns that a name ending in an ellipsis is not touching the next column's
   text. The gap was a rhythm step, 12px, while the session table spends 24
   between the same kind of things. */
.skill-table-head,
.skill-row {
  display: grid;
  grid-template-columns: minmax(190px, 1.35fr) minmax(130px, 0.8fr) minmax(155px, 0.85fr);
  gap: var(--size-column-gutter);
  align-items: center;
}

/* The head is a band with its own tone, which is already the boundary. It was
   also drawing a hairline above and below itself — the same separation said
   three times, in a product whose rule is that it is said once. */
.skill-table-head {
  min-height: var(--size-control-height-compact);
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-tertiary);
  font: var(--font-chrome);
  background: var(--color-surface-muted);
}

.skill-row {
  width: 100%;
  padding: var(--space-3);
  border: 0;
  border-bottom: 1px solid var(--color-rule);
  color: var(--color-text);
  text-align: left;
  background: transparent;
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &.selected {
    background: var(--color-surface-selected);
    box-shadow: inset 3px 0 0 var(--color-focus-ring);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -3px;
  }
}

.skill-identity,
.skill-scope,
.skill-state {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

:is(.skill-name, .scope-name) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-name {
  font-size: var(--font-size-interface);
}

.scope-name {
  font: var(--font-label);
}

:is(.skill-summary, .scope-source, .state-reason) {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.mobile-column-label {
  display: none;
}

/* Three lines of the description, not two. A skill's first sentence is what
   tells one apart from another in a list of forty, and two lines cut most of
   them mid-clause. */
.skill-summary {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.state-reason {
  overflow-wrap: anywhere;
}

@container skills-catalog (max-width:680px) {
  .skills-filters {
    grid-template-columns: 1fr;
  }
}

@container skills-catalog (max-width:520px) {
  .skill-table-head {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    white-space: nowrap;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .skill-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    align-items: start;
  }

  .skill-identity {
    grid-column: 1 / -1;
  }

  .mobile-column-label {
    display: block;
    color: var(--color-text-tertiary);
    font: var(--font-chrome);
  }

  :is(.skill-name, .scope-name) {
    overflow-wrap: anywhere;
    white-space: normal;
  }
}

@container skills-catalog (max-width:360px) {
  .skill-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .skill-identity {
    grid-column: auto;
  }
}
</style>
