import { onBeforeUnmount, onMounted, ref } from 'vue'

import type { PendingCount } from '@/features/input-requests/composables/useInputRequests.ts'

import { planningTargetRoute } from '@/shared/api/planningTarget.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

export function useGlobalWorkActions(writeRoute: (route: PlatformRoute) => void) {
  const finderOpen = ref(false)
  const requestsOpen = ref(false)
  const pendingRequestCount = ref<PendingCount | null>(null)

  function openTarget(target: PlanningTarget) {
    writeRoute(planningTargetRoute(target))
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
