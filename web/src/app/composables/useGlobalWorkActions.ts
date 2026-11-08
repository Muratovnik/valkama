import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

import type { PendingCount } from '@/features/input-requests/composables/useInputRequests.ts'

import { planningTargetRoute } from '@/shared/api/planningTarget.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

export function useGlobalWorkActions(
  writeRoute: (route: PlatformRoute) => void,
  questionsAsked: Readonly<Ref<number>>,
  cardQuestionAsked: Readonly<Ref<boolean>>,
) {
  const finderOpen = ref(false)
  /** What the finder opens searching for; blank opens it on the search it last held. */
  const finderText = ref('')
  const requestsOpen = ref(false)
  const pendingRequestCount = ref<PendingCount | null>(null)

  function openTarget(target: PlanningTarget) {
    writeRoute(planningTargetRoute(target))
    finderOpen.value = false
    requestsOpen.value = false
  }

  /** The finder, searching for text a surface hands it: the board filter's last row. */
  function findText(text: string) {
    finderText.value = text
    finderOpen.value = true
  }

  // A text handed over is for that one opening; Ctrl+K later opens on what was left there.
  watch(finderOpen, (open) => {
    if (!open) finderText.value = ''
  })

  // Asked before this ran, on the load the address came in with, or any time later.
  watch(
    questionsAsked,
    (asked) => {
      if (asked === 0) return
      finderOpen.value = false
      requestsOpen.value = true
    },
    { immediate: true },
  )

  // The card's question takes the keyboard, which a surface over the card would hold.
  watch(cardQuestionAsked, (asked) => {
    if (!asked) return
    finderOpen.value = false
    requestsOpen.value = false
  })

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
  return { finderOpen, finderText, findText, requestsOpen, pendingRequestCount, openTarget }
}
