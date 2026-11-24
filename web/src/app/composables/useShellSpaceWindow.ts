/**
 * The main store as the shell writes it, and the space window, which edits its spaces.
 *
 * The window is opened from the page of every space and from the context bar, and rendered
 * once beside the other overlays. After a save the shell reads its spaces again and follows
 * the space, in the section it is in: into a new one, onto its new key from the old one, and to every space from one
 * that was removed. Any other save refreshes what is on screen, whose read says itself if it
 * fails.
 */
import { computed } from 'vue'
import type { Ref } from 'vue'

import { provideSpaceWindow } from '@/features/space-window/spaceWindowHost.ts'
import type { SpaceWindowOutcome } from '@/features/space-window/useSpaceWindowForm.ts'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { sameSpace } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'

interface ShellSpaceWindowInputs {
  contextReady: Readonly<Ref<PlatformContextReady | null>>
  scope: Readonly<Ref<OperatingScope>>
  loadContext: () => Promise<void>
  refresh: () => Promise<void> | undefined
  switchScope: (scope: OperatingScope) => void
}

export function useShellSpaceWindow(inputs: ShellSpaceWindowInputs) {
  /** The main store's data scope while it can be written, and null otherwise. */
  const primaryWriteScopeId = computed(() => {
    const primary = inputs.contextReady.value?.primary
    return primary?.is_writable === true ? primary.data_scope_id : null
  })
  async function spaceSaved({ saved, before }: SpaceWindowOutcome) {
    await inputs.loadContext()
    const scope = inputs.scope.value
    const here = before !== null && scope.kind === 'space' && sameSpace(scope.space_ref, before)
    if (saved.operation === 'created' && saved.space_ref !== null) {
      inputs.switchScope({ kind: 'space', space_ref: saved.space_ref })
      return
    }
    if (saved.operation === 'removed' && here) {
      inputs.switchScope({ kind: 'global' })
      return
    }
    if (here && saved.space_ref !== null && !sameSpace(saved.space_ref, before)) {
      inputs.switchScope({ kind: 'space', space_ref: saved.space_ref })
      return
    }
    await inputs.refresh()?.catch(() => {})
  }

  provideSpaceWindow(
    () => primaryWriteScopeId.value,
    (outcome) => void spaceSaved(outcome),
  )
  return { primaryWriteScopeId }
}
