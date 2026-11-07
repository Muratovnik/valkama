/**
 * A session named by its id, from a reference in free text or from an address the shell
 * recovered: its context, read from the server, shown beside the workspace. Asked to go
 * there, as an address that named a session is, it opens the session's work item instead
 * when that item's space is bound to exactly one known project, and shows the context
 * only when it is not.
 *
 * An address waits until the modules and the context are known, since the item's route
 * is resolved against both.
 */
import { ref, watch } from 'vue'
import type { Ref } from 'vue'

import { resolveSessionWorkItemRoute } from '@/features/session-open/sessionWorkItemRoute.ts'

import { fetchSessionContext } from '@/shared/api/api.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { ResolvedRef } from '@/shared/types/reference.ts'

interface SessionOpeningInputs {
  contextReady: Ref<PlatformContextReady | null>
  moduleRegistrations: Ref<readonly ModuleRegistration[]>
  modulesSettled: Ref<boolean>
  /** The session an address named, until it is opened. */
  pendingSession: Ref<string>
  refused: () => void
  writeRoute: (next: PlatformRoute) => void
}

export function useSessionOpening(inputs: SessionOpeningInputs) {
  const { contextReady, moduleRegistrations, modulesSettled, pendingSession, writeRoute } = inputs
  const sessionContext = ref<ResolvedRef | null>(null)

  async function openSession(sessionId: string, navigate = false) {
    try {
      const context = await fetchSessionContext(sessionId)
      if (navigate && context.resolved && context.work_item && context.space_root?.resource_ref) {
        const next = resolveSessionWorkItemRoute(
          context.space_root.resource_ref,
          context.work_item,
          contextReady.value,
          moduleRegistrations.value,
        )
        if (next) {
          writeRoute(next)
          return
        }
      }
      sessionContext.value = context
    } catch (error) {
      inputs.refused()
      console.error(error)
    }
  }

  watch([pendingSession, modulesSettled, contextReady], () => {
    if (!pendingSession.value || !modulesSettled.value || !contextReady.value) return
    const id = pendingSession.value
    pendingSession.value = ''
    void openSession(id, true)
  })

  return { openSession, sessionContext }
}
