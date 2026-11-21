<script setup lang="ts">
/**
 * The scope's tasks under no goal, by project and by label, each row saying how many of its
 * tasks stand in each of the eight categories, in the model's order: an open category as they
 * stand now, Done and Cancelled those that came to a close in the period. By project each task
 * stands in one row, so the rows add up to the count over them; by label in the row of each of
 * its labels, or of none, adding up to no total. The rows come as the read orders them, the most
 * tasks first.
 *
 * Each table is a section's (`ChartTable`); each row carries `data-row`, its project's id or its
 * label (`-` for none, `*` for several projects), and each figure `data-category`. Where the
 * columns do not fit the frame, the headings and the names come down to their longest words
 * (`useTableFit`, `least`); where even that does not fit, the tables scroll sideways with their
 * names held at the start.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useVolumesWords } from '@/pages/volumes/composables/useVolumesWords.ts'

import { useTableFit } from '@/widgets/section-table/composables/useTableFit.ts'

import { STATE_CATEGORIES } from '@/shared/api/planningModel.ts'
import type { Volumes } from '@/shared/api/volumesReadApi.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'

const props = defineProps<{ outside: Volumes['outside'] }>()

const { t } = useI18n()
const words = useVolumesWords()

const tables = computed(() => [
  {
    key: 'project',
    label: t('volumes.outside.byProject'),
    heading: t('volumes.outside.project'),
    rows: props.outside.by_project.map((row) => ({
      key: row.project.id ?? (row.project.combinations ? '*' : '-'),
      name: words.projectName(row.project, null),
      categories: row.categories,
    })),
  },
  {
    key: 'label',
    label: t('volumes.outside.byLabel'),
    heading: t('volumes.outside.tag'),
    rows: props.outside.by_label.map((row) => ({
      key: row.label ?? '-',
      name: row.label ?? t('volumes.outside.noLabel'),
      categories: row.categories,
    })),
  },
])
const emptyWords = computed(() => ({ empty: t('volumes.outside.empty') }))

const root = ref<HTMLElement | null>(null)
/** Both tables at their words' width while it fits, at their least where it does not. */
const fit = useTableFit(root, [() => tables.value], () => ({
  steps: ['one', 'least'],
  otherwise: 'one',
}))
</script>

<template>
  <section
    ref="root"
    class="volumes-outside"
    :aria-label="t('volumes.outside.label')"
    :data-fit="fit"
  >
    <h2 class="volumes-heading">
      {{ t('volumes.outside.label') }}
      <span class="volumes-heading-count">{{
        t('volumes.outside.count', { count: outside.tasks }, outside.tasks)
      }}</span>
    </h2>
    <div
      v-for="table in tables"
      :key="table.key"
      class="volumes-outside-part"
    >
      <h3 class="volumes-subheading">{{ table.label }}</h3>
      <ChartTable
        :empty="!table.rows.length"
        :label="`${t('volumes.outside.label')}: ${table.label}`"
        :words="emptyWords"
      >
        <thead>
          <tr>
            <th
              scope="col"
              class="chart-cell chart-heading"
            >
              {{ table.heading }}
            </th>
            <th
              v-for="category in STATE_CATEGORIES"
              :key="category"
              scope="col"
              class="chart-cell chart-heading"
              data-numeric="true"
            >
              {{ t(`workItem.category.${category}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in table.rows"
            :key="row.key"
            :data-row="row.key"
          >
            <th
              scope="row"
              class="chart-cell chart-name"
            >
              {{ row.name }}
            </th>
            <td
              v-for="category in STATE_CATEGORIES"
              :key="category"
              class="chart-cell volumes-figure"
              data-numeric="true"
              :data-category="category"
            >
              {{ row.categories[category] ?? 0 }}
            </td>
          </tr>
        </tbody>
      </ChartTable>
    </div>
  </section>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped src="@/pages/volumes/components/volumesSection.css"></style>

<style scoped>
.volumes-outside,
.volumes-outside-part {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  min-width: 0;
}

/* Where the categories at 8em leave a column past the frame (`least`), their headings and the
   names come down to their longest words, never broken: at 1280 in Russian the tables stood 8 and
   15px past a frame of 948. */
.volumes-outside[data-fit='least'] :is(.chart-heading[data-numeric='true'], .chart-name) {
  min-inline-size: 0;
}
</style>
