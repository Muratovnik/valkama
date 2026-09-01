<script setup lang="ts">
/**
 * One selected skill across projects and clients.
 *
 * The server returns the bounded cross-product because it owns activation
 * truth. The screen discloses one skill at a time: projects remain comparable
 * as rows, clients remain declared columns, and the full inventory never turns
 * into a wall of peer cells.
 */
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { skillFailure, skillPresentation } from '@/pages/skills/utils/skillPresentation.ts'
import { skillResourceState } from '@/pages/skills/utils/skillResource.ts'
import type { SkillObservation } from '@/pages/skills/utils/skillResource.ts'

import { fetchSkillMatrix } from '@/entities/skill/api/skillMatrixApi.ts'
import type {
  SkillMatrix,
  SkillMatrixCellState,
  SkillMatrixRow,
} from '@/entities/skill/api/skillMatrixApi.ts'
import { updateSkillActivation } from '@/entities/skill/api/skillsApi.ts'

import {
  beginResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import type { SkillClient, SkillsPayload } from '@/shared/types/skills.ts'
import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SectionHeading from '@/shared/ui/SectionHeading.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(defineProps<{ revision?: number; skillKey?: string }>(), {
  revision: 0,
  skillKey: '',
})
const emit = defineEmits<{
  select: [key: string]
  updated: [payload: SkillsPayload]
}>()
const { t, te, locale } = useI18n()
const { clientLabel, reasonLabel } = skillPresentation(t, te, () => locale.value)

const MATRIX_KEY = 'skills-matrix'
const resource = ref(createResource<SkillObservation<SkillMatrix>>()) as Ref<
  ResourceState<SkillObservation<SkillMatrix>>
>
const busy = ref('')
const updateFailure = ref('')
const state = computed(() =>
  skillResourceState(resource.value, MATRIX_KEY, {
    empty: (payload) =>
      payload.clients.length === 0 || payload.projects.length === 0 || payload.skills.length === 0,
    emptyReason: 'skills.matrix.empty',
    failureReason: () => t('skills.matrix.error'),
  }),
)
const matrix = computed(() =>
  resource.value.key === MATRIX_KEY ? (resource.value.data?.value ?? null) : null,
)
const projects = computed(() => matrix.value?.projects ?? [])
const skills = computed(() => matrix.value?.skills ?? [])
const clients = computed(() => matrix.value?.clients ?? [])
const selectedRow = computed(
  () => skills.value.find((row) => row.key === props.skillKey) ?? skills.value[0] ?? null,
)
const skillOptions = computed<ChoiceOption[]>(() =>
  skills.value.map((row) => ({
    value: row.key,
    label: row.name,
    description:
      row.scope === 'global' ? t('skills.personal') : row.owner_project_id || t('skills.project'),
  })),
)
const matrixWriting = computed(() => busy.value !== '')
const matrixBusy = computed(() =>
  ['loading', 'refreshing'].includes(resource.value.status) || matrixWriting.value
    ? true
    : undefined,
)

function cellId(skill: string, projectId: string, client: SkillClient): string {
  return `${skill}:${projectId}:${client}`
}

function cellOf(
  row: SkillMatrixRow,
  projectId: string,
  client: SkillClient,
): SkillMatrixCellState | undefined {
  return row.cells.find((cell) => cell.project_id === projectId)?.clients[client]
}

function activationState(cell: SkillMatrixCellState | undefined): string {
  if (!cell || cell.enabled === null || cell.status === 'unavailable') return 'unavailable'
  return cell.enabled ? 'enabled' : 'disabled'
}

function activationLabel(cell: SkillMatrixCellState | undefined): string {
  return t(`skills.clientStatus.${activationState(cell)}`)
}

function clientScopeLabel(client: { project_scope: boolean }): string {
  return client.project_scope ? t('skills.matrix.projectScoped') : t('skills.matrix.globalScoped')
}

function pending(row: SkillMatrixRow, projectId: string, client: SkillClient): boolean {
  return busy.value === cellId(row.key, projectId, client)
}

function toggleable(cell: SkillMatrixCellState | undefined): boolean {
  return Boolean(cell?.project_scope && cell.can_toggle && cell.enabled !== null)
}

function enabledIn(row: SkillMatrixRow, projectId: string, client: SkillClient): boolean {
  return cellOf(row, projectId, client)?.enabled === true
}

function cellReason(cell: SkillMatrixCellState | undefined): string {
  if (!cell?.reason || !cell.project_scope) return ''
  return reasonLabel(cell.reason)
}

async function load() {
  resource.value = beginResource(resource.value, MATRIX_KEY)
  const generation = resource.value.generation
  try {
    const next = await fetchSkillMatrix()
    resource.value = resolveResource(resource.value, generation, MATRIX_KEY, {
      at: new Date().toISOString(),
      value: next,
    })
  } catch (error) {
    resource.value = rejectResource(resource.value, generation, MATRIX_KEY, skillFailure(error))
  }
}

async function toggle(row: SkillMatrixRow, projectId: string, client: SkillClient, next: boolean) {
  const id = cellId(row.key, projectId, client)
  if (busy.value) return
  busy.value = id
  updateFailure.value = ''
  try {
    emit('updated', await updateSkillActivation(row.key, client, next, projectId))
    await load()
  } catch {
    updateFailure.value = t('skills.updateError')
  } finally {
    busy.value = ''
  }
}

watch(() => props.revision, load, { immediate: true })
</script>

<template>
  <section class="skill-matrix">
    <header class="matrix-head">
      <SectionHeading as="h3">{{ t('skills.matrix.heading') }}</SectionHeading>
      <p class="matrix-intro">{{ t('skills.matrix.intro') }}</p>
    </header>

    <PlatformStatePanel
      :state="state"
      :empty-description="t('skills.matrix.emptyDetail')"
      @retry="load"
    >
      <div class="matrix-content">
        <div
          v-if="state.status === 'degraded' && state.reason"
          class="matrix-recovery"
        >
          <VButton
            variant="ghost"
            @click="load"
            >{{ t('skills.retry') }}</VButton
          >
        </div>

        <div class="matrix-skill-picker">
          <ChoiceSelect
            :model-value="selectedRow?.key ?? ''"
            :options="skillOptions"
            :label="t('skills.matrix.skillPicker')"
            :search-label="t('skills.matrix.skillSearch')"
            :empty-label="t('skills.matrix.skillSearchEmpty')"
            :disabled="matrixWriting"
            searchable
            @update:model-value="emit('select', $event)"
          />
        </div>

        <p
          v-if="updateFailure"
          class="matrix-update-error"
          role="alert"
        >
          {{ updateFailure }}
        </p>

        <div
          v-if="selectedRow"
          class="matrix-scroll"
          :aria-busy="matrixBusy"
        >
          <table class="matrix-table">
            <caption class="matrix-caption">
              {{
                t('skills.matrix.caption', { skill: selectedRow.name })
              }}
            </caption>
            <thead class="matrix-table-head">
              <tr class="matrix-head-row">
                <th
                  scope="col"
                  class="matrix-column matrix-project-column"
                >
                  {{ t('skills.matrix.project') }}
                </th>
                <th
                  v-for="client in clients"
                  :key="client.id"
                  scope="col"
                  class="matrix-column"
                >
                  <span class="matrix-client">{{ clientLabel(client.id) }}</span>
                  <span class="matrix-client-scope">{{ clientScopeLabel(client) }}</span>
                </th>
              </tr>
            </thead>
            <tbody class="matrix-table-body">
              <tr
                v-for="project in projects"
                :key="project.project_id"
                class="matrix-row"
              >
                <th
                  scope="row"
                  class="matrix-project"
                >
                  <span class="matrix-project-id">{{ project.project_id }}</span>
                  <span class="matrix-project-title">{{ project.project_title }}</span>
                </th>
                <td
                  v-for="client in clients"
                  :key="client.id"
                  class="matrix-slot"
                >
                  <span class="matrix-client-name">{{ clientLabel(client.id) }}</span>
                  <div class="matrix-cell">
                    <ToggleSwitch
                      v-if="toggleable(cellOf(selectedRow, project.project_id, client.id))"
                      :model-value="enabledIn(selectedRow, project.project_id, client.id)"
                      :label="
                        t('skills.matrix.toggleLabel', {
                          client: clientLabel(client.id),
                          project: project.project_id,
                          skill: selectedRow.name,
                        })
                      "
                      :on-label="t('skills.matrix.on')"
                      :off-label="t('skills.matrix.off')"
                      :busy="pending(selectedRow, project.project_id, client.id)"
                      :disabled="matrixWriting"
                      @update:model-value="
                        (next: boolean) => toggle(selectedRow, project.project_id, client.id, next)
                      "
                    />
                    <SemanticState
                      v-else
                      dimension="skill-readiness"
                      :state="activationState(cellOf(selectedRow, project.project_id, client.id))"
                      :label="activationLabel(cellOf(selectedRow, project.project_id, client.id))"
                    />
                    <span
                      v-if="cellReason(cellOf(selectedRow, project.project_id, client.id))"
                      class="matrix-reason"
                      >{{ cellReason(cellOf(selectedRow, project.project_id, client.id)) }}</span
                    >
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p
          v-if="matrix?.truncated"
          class="matrix-note"
        >
          {{ t('skills.matrix.truncated') }}
        </p>
        <p class="matrix-note">{{ t('skills.matrix.scopeNote') }}</p>
      </div>
    </PlatformStatePanel>
  </section>
</template>

<style scoped src="./SkillActivationMatrix.css"></style>
