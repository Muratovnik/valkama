<script setup lang="ts">
/**
 * The skills module: a searchable inventory first, then one bounded comparison.
 *
 * The catalogue owns the scan path, the route owns filters and selection, and
 * the shared inspector owns one skill's details and actions. Every remote read
 * uses the keyed generation state machine so a late answer cannot redraw a
 * newer scope or selection.
 */
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import SkillActivationMatrix from '@/pages/skills/components/SkillActivationMatrix.vue'
import SkillCatalogue from '@/pages/skills/components/SkillCatalogue.vue'
import SkillDetailDrawer from '@/pages/skills/components/SkillDetailDrawer.vue'
import SkillsToolbar from '@/pages/skills/components/SkillsToolbar.vue'
import * as skillCopy from '@/pages/skills/utils/skillPresentation.ts'
import { skillResourceState } from '@/pages/skills/utils/skillResource.ts'
import type { SkillObservation } from '@/pages/skills/utils/skillResource.ts'

import { fetchSkills } from '@/entities/skill/api/skillsApi'

import {
  beginResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import type { SkillEntry, SkillsPayload } from '@/shared/types/skills.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VIcon from '@/shared/ui/VIcon.vue'

type SkillsViewMode = 'catalog' | 'matrix'
type SkillStatusFilter = 'all' | 'disabled' | 'enabled' | 'issues'

const props = withDefaults(
  defineProps<{
    project?: string
    query?: string
    skill?: string
    status?: string
    view?: string
  }>(),
  { project: 'global', skill: '', query: '', status: 'all', view: 'catalog' },
)
const emit = defineEmits<{
  route: [
    route: { skill: { key: string; scope: 'global' | 'project'; project_id?: string } | null },
  ]
  state: [state: Record<string, string>]
}>()
const { t, te, locale } = useI18n()
const { reasonLabel } = skillCopy.skillPresentation(t, te, () => locale.value)

function viewMode(value: string): SkillsViewMode {
  return value === 'matrix' ? 'matrix' : 'catalog'
}

function statusMode(value: string): SkillStatusFilter {
  return ['all', 'disabled', 'enabled', 'issues'].includes(value)
    ? (value as SkillStatusFilter)
    : 'all'
}

const query = computed(() => props.query)
const selectedProject = computed(() => props.project || 'global')
const selectedKey = computed(() => props.skill)
const statusFilter = computed(() => statusMode(props.status))
const activeView = computed(() => viewMode(props.view))
const matrixRevision = ref(0)
const catalog = ref(createResource<SkillObservation<SkillsPayload>>()) as Ref<
  ResourceState<SkillObservation<SkillsPayload>>
>
const catalogKey = computed(() => `catalog:${selectedProject.value}`)
const payload = computed(() =>
  catalog.value.key === catalogKey.value ? (catalog.value.data?.value ?? null) : null,
)
const catalogState = computed(() =>
  skillResourceState(catalog.value, catalogKey.value, {
    failureReason: () => t('skills.errorBody'),
  }),
)
const catalogBusy = computed(() =>
  ['loading', 'refreshing'].includes(catalog.value.status) ? true : undefined,
)

watch(catalogKey, () => void loadCatalog(), { immediate: true })

/** What the inventory could not read, as one notice per source. */
const inventoryIssues = computed(() => {
  if (!payload.value) return []
  const issues: Array<{ code: string; context: string | null; key: string; title: string }> = []
  const registry = payload.value.registry
  if (registry.status !== 'available' || registry.truncated) {
    issues.push({
      key: 'registry',
      title: t('skills.registry'),
      code: registry.reason || `host_runtime_registry_${registry.status}`,
      context: null,
    })
  }
  for (const root of payload.value.roots) {
    if (root.availability === 'available' && root.validation === 'valid' && !root.truncated)
      continue
    issues.push({
      key: root.id,
      title: t(`skills.sources.${root.source}`),
      code: root.reason || 'root_unavailable',
      context: root.project_title,
    })
  }
  return issues
})
const scopedSkills = computed(() => {
  const source = payload.value?.skills ?? []
  if (selectedProject.value === 'global') return source.filter((skill) => skill.scope === 'global')
  return source.filter(
    (skill) =>
      skill.project_id === selectedProject.value ||
      skill.owner_project_id === selectedProject.value,
  )
})
const selectedSkill = computed(
  () => payload.value?.skills.find((skill) => skill.key === selectedKey.value) ?? null,
)

function chooseSkill(skill: SkillEntry) {
  const routeSkill: { key: string; scope: 'global' | 'project'; project_id?: string } = {
    key: skill.key,
    scope: skill.scope,
  }
  if (skill.scope === 'project' && skill.project_id) routeSkill.project_id = skill.project_id
  emit('route', { skill: routeSkill })
}

function chooseSkillKey(key: string) {
  const skill = payload.value?.skills.find((entry) => entry.key === key)
  if (skill) chooseSkill(skill)
}

function closeSkill() {
  emit('route', { skill: null })
}

/** The route state write is a replacement, so every current field travels together. */
function emitState(
  update: Partial<{ query: string; status: SkillStatusFilter; view: SkillsViewMode }>,
) {
  const next = {
    query: query.value,
    status: statusFilter.value,
    view: activeView.value,
    ...update,
  }
  const state: Record<string, string> = {}
  const value = next.query.trim()
  if (value) state.query = value
  if (next.status !== 'all') state.status = next.status
  if (next.view !== 'catalog') state.view = next.view
  emit('state', state)
}

function updateQuery(value: string) {
  emitState({ query: value })
}

function updateStatus(value: string) {
  emitState({ status: statusMode(value) })
}

function updateView(value: SkillsViewMode) {
  emitState({ view: value })
}

async function loadCatalog() {
  const key = catalogKey.value
  catalog.value = beginResource(catalog.value, key)
  const generation = catalog.value.generation
  try {
    const next = await fetchSkills()
    catalog.value = resolveResource(catalog.value, generation, key, {
      at: new Date().toISOString(),
      value: next,
    })
  } catch (error) {
    catalog.value = rejectResource(catalog.value, generation, key, skillCopy.skillFailure(error))
  }
}

/** A write returns the whole inventory and invalidates any older catalogue read. */
function acceptCatalog(next: SkillsPayload) {
  const key = catalogKey.value
  catalog.value = beginResource(catalog.value, key)
  const generation = catalog.value.generation
  catalog.value = resolveResource(catalog.value, generation, key, {
    at: new Date().toISOString(),
    value: next,
  })
}

async function refresh() {
  matrixRevision.value += 1
  await loadCatalog()
}
</script>

<template>
  <section
    class="skills-view"
    :aria-label="t('skills.catalog')"
  >
    <SkillsToolbar
      :loading="Boolean(catalogBusy)"
      :project-count="payload?.summary.projects ?? 0"
      :skill-count="payload?.summary.skills ?? 0"
      :view="activeView"
      @refresh="refresh"
      @view="updateView"
    />

    <PlatformStatePanel
      :state="catalogState"
      @retry="refresh"
    >
      <div class="skills-content">
        <div
          v-if="inventoryIssues.length"
          class="inventory-notices"
          role="status"
        >
          <div
            v-for="issue in inventoryIssues"
            :key="issue.key"
            class="inventory-notice"
          >
            <VIcon
              name="info"
              class="notice-icon"
              :size="17"
            /><span class="notice-source"
              ><strong class="notice-title">{{ issue.title }}</strong
              ><small
                v-if="issue.context"
                class="notice-context"
                >{{ issue.context }}</small
              ></span
            ><span class="notice-reason">{{ reasonLabel(issue.code) }}</span>
          </div>
        </div>

        <div
          class="skills-workspace"
          :data-view="activeView"
          :aria-busy="catalogBusy"
        >
          <SkillCatalogue
            v-if="activeView === 'catalog'"
            :skills="scopedSkills"
            :selected-key="selectedKey"
            :query="query"
            :status="statusFilter"
            @choose="chooseSkill"
            @query="updateQuery"
            @status="updateStatus"
          />
          <SkillActivationMatrix
            v-else
            :revision="matrixRevision"
            :skill-key="selectedKey"
            @select="chooseSkillKey"
            @updated="acceptCatalog"
          />
        </div>
      </div>
    </PlatformStatePanel>

    <SkillDetailDrawer
      :clients="payload?.clients ?? []"
      :skill="selectedSkill"
      @close="closeSkill"
      @updated="acceptCatalog"
    />
  </section>
</template>

<style scoped>
.skills-view,
.skills-content {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

.inventory-notices {
  display: grid;
  gap: var(--space-1);
}

.inventory-notice {
  display: grid;
  grid-template-columns: auto minmax(120px, auto) minmax(0, 1fr);
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-rule);
  font-size: var(--font-size-dense);
  background: var(--color-surface-muted);
  border-radius: var(--radius-status);
}

.notice-icon {
  color: var(--color-warning);
}

.notice-source {
  display: grid;
  min-width: 0;
}

.notice-context {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.notice-reason {
  color: var(--color-text-muted);
}

.skills-workspace {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: var(--color-surface-sheet);
  border-radius: var(--radius-card);
}

@container workspace (width <= 696px) {
  .inventory-notice {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .notice-reason {
    grid-column: 2;
  }
}
</style>
