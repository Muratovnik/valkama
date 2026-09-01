<script setup lang="ts">
import {
  ANALYTICS_INSPECTOR_DEFAULT_WIDTH,
  ANALYTICS_INSPECTOR_MAX_WIDTH,
  ANALYTICS_INSPECTOR_MIN_WIDTH,
  ANALYTICS_INSPECTOR_STORAGE_KEY,
} from '@/shared/lib/shellLayout.ts'
import DrawerFrame from '@/shared/ui/DrawerFrame.vue'
import InspectorDrawer from '@/shared/ui/InspectorDrawer.vue'

export interface AnalyticsTableColumn {
  key: string
  label: string
}

defineProps<{
  caption: string
  closeLabel: string
  columns: AnalyticsTableColumn[]
  open: boolean
  rows: Record<string, string | number>[]
  title: string
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <InspectorDrawer
    panel-class="analytics-table-drawer"
    :open="open"
    :title="title"
    :aria-label="title"
    :width-storage-key="ANALYTICS_INSPECTOR_STORAGE_KEY"
    :drawer-default-width="ANALYTICS_INSPECTOR_DEFAULT_WIDTH"
    :drawer-min-width="ANALYTICS_INSPECTOR_MIN_WIDTH"
    :drawer-max-width="ANALYTICS_INSPECTOR_MAX_WIDTH"
    @close="emit('close')"
  >
    <DrawerFrame
      :title="title"
      :subtitle="caption"
      :close-label="closeLabel"
      @close="emit('close')"
    >
      <div class="analytics-table-scroll">
        <table>
          <caption>
            {{
              caption
            }}
          </caption>
          <thead>
            <tr>
              <th
                v-for="column in columns"
                :key="column.key"
                scope="col"
              >
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in rows"
              :key="index"
            >
              <td
                v-for="column in columns"
                :key="column.key"
              >
                {{ row[column.key] }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </DrawerFrame>
  </InspectorDrawer>
</template>

<style scoped>
.analytics-table-scroll {
  max-width: 100%;
  max-height: 100%;
  overflow: auto;
  border-radius: var(--radius-card);
}

table {
  width: 100%;
  min-width: 820px;
  table-layout: auto;
  border-collapse: collapse;
}

caption {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

th,
td {
  vertical-align: top;
  min-width: 112px;
  padding: var(--space-3);
  border-bottom: 1px solid var(--color-rule);
  font: var(--font-note);
  text-align: left;
  overflow-wrap: break-word;
  white-space: normal;
}

th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--color-text-muted);
  font-size: var(--font-size-meta);
  font-weight: 700;
  overflow-wrap: normal;
  white-space: nowrap;

  /* Sticky needs opaque paint, but a tinted band would put a second divide on
     the boundary the hairline below already draws — so the header wears the
     drawer's own ground. */
  background: var(--color-surface);
}

th:first-child,
td:first-child {
  min-width: 260px;
}

tbody tr:last-child td {
  border-bottom: 0;
}

tbody tr:hover {
  background: var(--color-surface-hover);
}
</style>
