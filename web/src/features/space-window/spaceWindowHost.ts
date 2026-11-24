/**
 * Who opens the space window, and what each opener may offer.
 *
 * The window stands once, in the shell, beside the other overlays; its ways in are on the
 * page of every space and in the context bar, which the shell's own window cannot reach, so
 * the shell hands them a way to open it. A space of an attached store has no «Configure»:
 * such a store is opened read-only, and only the main one's spaces are edited here.
 *
 * `saves` counts the saves the window made, so what shows the registry's projects reads
 * them again after one. The window itself takes what it shows from the same host
 * (`useSpaceWindowState`), so the shell only places it.
 */
import { inject, provide, readonly, ref } from 'vue'
import type { InjectionKey, Ref } from 'vue'

import type { SpaceWindowOutcome } from '@/features/space-window/useSpaceWindowForm.ts'

import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'

export type SpaceWindowTarget = { kind: 'create' } | { kind: 'edit'; space: PlanningSpaceRef }

export interface SpaceWindowOpener {
  readonly saves: Readonly<Ref<number>>
  /** Whether a space can be created here: the main store is known and writable. */
  creatable: () => boolean
  create: () => void
  edit: (space: PlanningSpaceRef) => void
  /** Whether the space is one of the main store's, which the window edits. */
  editable: (space: PlanningSpaceRef) => boolean
}

/** The window's own side of the host: what it shows, and what it reports. */
interface SpaceWindowState {
  target: Readonly<Ref<SpaceWindowTarget | null>>
  close: () => void
  saved: (outcome: SpaceWindowOutcome) => void
}

const SPACE_WINDOW: InjectionKey<SpaceWindowOpener> = Symbol('space-window')
const SPACE_WINDOW_STATE: InjectionKey<SpaceWindowState> = Symbol('space-window-state')

/**
 * Hand the window's openers down from the shell, which renders the window once.
 * `primary` is the main store's data scope while it is writable, and null otherwise;
 * `saved` is what the shell does after each save.
 */
export function provideSpaceWindow(
  primary: () => string | null,
  saved: (outcome: SpaceWindowOutcome) => void,
) {
  const target = ref<SpaceWindowTarget | null>(null)
  const saves = ref(0)
  const opener: SpaceWindowOpener = {
    create: () => {
      if (primary() !== null) target.value = { kind: 'create' }
    },
    edit: (space) => {
      if (opener.editable(space)) target.value = { kind: 'edit', space }
    },
    editable: (space) => primary() !== null && space.data_scope_id === primary(),
    creatable: () => primary() !== null,
    saves: readonly(saves),
  }
  provide(SPACE_WINDOW, opener)
  provide(SPACE_WINDOW_STATE, {
    target: readonly(target),
    close: () => {
      target.value = null
    },
    saved: (outcome) => {
      saves.value += 1
      saved(outcome)
    },
  })
}

/** The window's openers, or null where no shell provides the window. */
export function useSpaceWindow(): SpaceWindowOpener | null {
  return inject(SPACE_WINDOW, null)
}

/** The window's own side, for the window the shell renders; null outside a shell. */
export function useSpaceWindowState(): SpaceWindowState | null {
  return inject(SPACE_WINDOW_STATE, null)
}
