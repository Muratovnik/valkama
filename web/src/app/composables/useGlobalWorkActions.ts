import { onBeforeUnmount, onMounted, ref } from 'vue'

import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

export function useGlobalWorkActions(writeRoute: (route: PlatformRoute) => void) {
  const finderOpen = ref(false)
  const requestsOpen = ref(false)
  const pendingRequestCount = ref<number | null>(null)

  function openTarget(target: PlanningTarget) {
    writeRoute({
      module_id: 'planning',
      scope: { kind: 'project', project_ref: { project_id: target.project_id } },
      entity: planningWorkItemEntity({ space_ref: target.space_ref, reference: target.reference }),
    })
    finderOpen.value = false
    requestsOpen.value = false
  }

  function findShortcut(event: KeyboardEvent) {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.code !== 'KeyK'
    )
      return
    event.preventDefault()
    finderOpen.value = true
  }

  onMounted(() => window.addEventListener('keydown', findShortcut))
  onBeforeUnmount(() => window.removeEventListener('keydown', findShortcut))
  return { finderOpen, requestsOpen, pendingRequestCount, openTarget }
}
