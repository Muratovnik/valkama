/**
 * The project's resources the open module can take as its second context, the one
 * the address names, and the choice of another. A choice is rechecked against the
 * manifest current at the press, and a refused one changes nothing.
 */
import { computed } from 'vue'
import type { Ref } from 'vue'

import {
  resolveResourceSelection,
  selectableProjectResources,
} from '@/app/composables/useModuleRouteAuthority.ts'

import { EMPTY_WORK_FILTER, writeWorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

interface ProjectResourceInputs {
  activeManifest: Ref<ModuleManifest | undefined>
  contextReady: Ref<PlatformContextReady | null>
  modulesAuthoritative: Ref<boolean>
  route: Ref<PlatformRoute>
  refused: () => void
  writeRoute: (next: PlatformRoute) => void
}

export function useProjectResources(inputs: ProjectResourceInputs) {
  const { activeManifest, contextReady, modulesAuthoritative, route, writeRoute } = inputs
  const mappedProjectResources = computed(() => {
    const { scope } = route.value
    return scope.kind === 'project'
      ? (contextReady.value?.projects.find(
          (project) => project.project_id === scope.project_ref.project_id,
        )?.resources ?? [])
      : []
  })
  const availableProjectResources = computed(() =>
    modulesAuthoritative.value
      ? selectableProjectResources(activeManifest.value, mappedProjectResources.value)
      : [],
  )
  const selectedResourceRef = computed<EntityRef | undefined>(() => {
    const entity = route.value.entity
    let selected: EntityRef | undefined
    if (entity !== undefined) {
      const encoded = JSON.stringify(entity)
      if (
        availableProjectResources.value.some(
          (resource) => JSON.stringify(resource.resource_ref) === encoded,
        )
      )
        selected = entity
    }
    return selected
  })

  function selectResource(value: string) {
    const selected = availableProjectResources.value.find(
      (resource) => JSON.stringify(resource.resource_ref) === value,
    )
    const proposed =
      selected && modulesAuthoritative.value
        ? resolveResourceSelection(activeManifest.value, route.value, selected)
        : null
    if (proposed === null || activeManifest.value === undefined) {
      inputs.refused()
      return
    }
    // The Work filter names labels and holders of the space being left, so it
    // stays with that space's address; Back to it brings the filter back.
    const { state } = writeWorkFilter(
      proposed.state,
      EMPTY_WORK_FILTER,
      activeManifest.value.state_schema.max_bytes,
    )
    writeRoute({ ...proposed, state: Object.keys(state).length ? state : undefined })
  }

  return { availableProjectResources, selectedResourceRef, selectResource }
}
