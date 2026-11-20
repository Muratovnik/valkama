import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

import type { PendingCount } from '@/features/input-requests/composables/useInputRequests.ts'

import type { QuestionScope } from '@/shared/api/inputRequestApi.ts'
import { planningTargetRoute } from '@/shared/api/planningTarget.ts'
import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

/**
 * The shell's ways to work from anywhere: the finder, the questions waiting, and opening a task.
 *
 * The questions window opens on every space's questions, or on those of what a space's board
 * holds, and of its project, when a place narrowed to that scope opens it (`openRequests`); the
 * narrowing lasts until the window closes.
 *
 * `inPlace` is where the module on show opens a task's card itself, over its page, or null where
 * it does not; a task opened from the finder, the questions or a reference in any text goes
 * through it, so every way of opening one decides the same way.
 */
export function useGlobalWorkActions(
  writeRoute: (route: PlatformRoute) => void,
  questionsAsked: Readonly<Ref<number>>,
  cardQuestionAsked: Readonly<Ref<boolean>>,
  inPlace: (target: PlanningTarget) => PlatformRoute | null,
) {
  const finderOpen = ref(false)
  /** What the finder opens searching for; blank opens it on the search it last held. */
  const finderText = ref('')
  const requestsOpen = ref(false)
  /** The scope the questions window is narrowed to, or none for every space's. */
  const requestsScope = ref<QuestionScope | null>(null)
  const pendingRequestCount = ref<PendingCount | null>(null)

  /** A place a surface over the module asks for, which that surface gives way to. */
  function openRoute(route: PlatformRoute) {
    writeRoute(route)
    finderOpen.value = false
    requestsOpen.value = false
  }

  /** The questions window, narrowed to a scope when a place in that scope opens it. */
  function openRequests(scope: QuestionScope | null = null) {
    requestsScope.value = scope
    requestsOpen.value = true
  }

  watch(requestsOpen, (open) => {
    if (!open) requestsScope.value = null
  })

  /** A task's card: over the module on show where it opens one, else on the task's board. */
  const openTarget = (target: PlanningTarget) =>
    openRoute(inPlace(target) ?? planningTargetRoute(target))

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
      openRequests()
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
  return {
    finderOpen,
    finderText,
    findText,
    requestsOpen,
    requestsScope,
    openRequests,
    pendingRequestCount,
    openRoute,
    openTarget,
  }
}
