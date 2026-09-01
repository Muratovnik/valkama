<script setup lang="ts">
/**
 * The cards that have been open longest, as a table you can open a card from.
 *
 * The whole row is clickable for a pointer and the title is a button for a
 * keyboard, which is why the row's own handler is not a key handler: the button
 * inside carries the same action and the row's accessible name, and a second
 * handler would fire it twice. The chevron says the row opens something and is
 * hidden from the reader, which the title's label already tells.
 */
import { useI18n } from 'vue-i18n'

import { analyticsFormatters } from '@/widgets/analytics-dashboard/utils/analyticsFormat.ts'

import type { DashboardPayload } from '@/shared/types/analytics.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{ rows: DashboardPayload['longest_open'] }>()
const emit = defineEmits<{ 'open-work-item': [reference: string] }>()
const { t } = useI18n()
const { duration } = analyticsFormatters(t)
</script>

<template>
  <div class="table-panel">
    <header class="table-panel-head">
      <h3 class="panel-title">{{ t('dashboard.longestOpen') }}</h3>
      <p
        id="longest-note"
        class="panel-hint"
      >
        {{ t('dashboard.age') }}
      </p>
    </header>
    <div
      v-if="rows.length"
      class="table-wrap"
    >
      <table
        class="card-table"
        aria-describedby="longest-note"
      >
        <caption class="visually-hidden">
          {{
            t('dashboard.longestOpen')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">{{ t('dashboard.card') }}</th>
            <th scope="col">{{ t('dashboard.status') }}</th>
            <th scope="col">{{ t('dashboard.age') }}</th>
            <th scope="col">
              <span class="visually-hidden">{{ t('dashboard.open') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            class="card-row"
            @click="emit('open-work-item', row.id)"
          >
            <td>{{ row.id }}</td>
            <td
              class="long-cell"
              :title="row.title"
            >
              <button
                type="button"
                class="row-title"
                :aria-label="
                  t('dashboard.openWorkItemRow', { reference: row.id, title: row.title })
                "
                @click.stop="emit('open-work-item', row.id)"
              >
                {{ row.title }}
              </button>
            </td>
            <td>
              <SemanticState
                dimension="work-item-state"
                :state="row.state_category"
                :label="row.column ?? t('dashboard.unknown')"
              />
            </td>
            <td>{{ duration(row.seconds) }}</td>
            <td
              class="row-chevron"
              aria-hidden="true"
            >
              <VIcon
                name="chevron-right"
                :size="18"
                :stroke-width="1.7"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <DataEmptyState
      v-else
      :title="t('dashboard.noOpen')"
      :description="t('dashboard.noOpenDescription')"
    />
  </div>
</template>

<style scoped>
.table-panel {
  min-width: 0;
  padding: var(--space-5);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.table-panel-head {
  margin-bottom: var(--space-3);
}

.panel-title {
  margin: 0;
  font-size: var(--font-size-section);
}

.panel-hint {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.table-wrap {
  max-width: 100%;
  overflow-x: auto;
}

.card-table {
  width: 100%;
  min-width: 600px;
  font-size: var(--font-size-interface);
  border-collapse: collapse;

  th {
    color: var(--color-text-muted);
    font: 600 var(--font-size-meta)/var(--line-height-snug) var(--font-family-interface);
  }

  :is(th, td) {
    vertical-align: middle;
    padding: var(--space-3);
    border-top: 1px solid var(--color-rule);
    text-align: left;
  }

  td.row-chevron {
    width: 36px;
    color: var(--color-text-muted);
    text-align: right;
  }
}

.long-cell {
  max-width: 44ch;
  overflow-wrap: anywhere;
  white-space: normal;
}

.card-row {
  transition: background-color var(--duration-quick) var(--ease-out);
  cursor: pointer;

  &:is(:hover, :focus-within) {
    background: var(--color-surface-active);
  }

  &:focus-within {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }
}

.row-title {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--size-control-target);
  padding: var(--space-2) 0;
  border: 0;
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
  text-align: left;
  overflow-wrap: anywhere;
  background: transparent;
  cursor: pointer;

  &:hover {
    color: var(--color-info);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  &:focus-visible {
    outline: none;
  }
}
</style>
