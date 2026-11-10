/**
 * How the side panel's list opens a session: one press and one panel for the whole list,
 * held above its rows (`NavWorkGroup`). A session's own row and «Open session» on an item's row
 * hand their press here, and a plan that takes more than one press goes on in the list's
 * `OpenPanel`, not in the row's. A row is the frame's: a refresh drops it, fades it or moves it
 * into a fold, and a panel the row held would go with it, mid-step and with the focus in it.
 *
 * What was pressed is read at the press and kept until the next one, so the status region
 * names the session the row stood for after the row has gone. One press is planned at a time,
 * and while the panel is open no row takes another.
 */
import { computed, inject, provide, shallowRef } from 'vue'
import type { ComputedRef, InjectionKey } from 'vue'

import type { OpenTarget } from '@/features/session-open/openPlan.ts'
import { useOpenPress } from '@/features/session-open/openPress.ts'
import type { OpenPress } from '@/features/session-open/openPress.ts'

/** A press on a row: which row, the session it opens, and whose session it is in words. */
interface RowPress {
  key: string
  name: string
  target: OpenTarget
}

interface RowOpen {
  /** Whether this row's press is still being planned. */
  busy: (key: string) => boolean
  press: (pressed: RowPress) => void
}

const ROW_OPEN: InjectionKey<RowOpen> = Symbol('nav-row-open')

/** The list's one opener, given to its rows; the list draws the panel it returns. */
export function provideRowOpen(): Pick<OpenPress, 'finished' | 'panel'> & {
  /** Whose session the panel opens, as the row that was pressed named it. */
  context: ComputedRef<string>
} {
  const pressed = shallowRef<RowPress | null>(null)
  const { busy, finished, panel, press } = useOpenPress(
    () => pressed.value?.target ?? { kind: 'session', session: '' },
    () => pressed.value?.name ?? '',
  )
  provide(ROW_OPEN, {
    busy: (key) => busy.value && pressed.value?.key === key,
    press(next) {
      if (busy.value || panel.value !== null) return
      pressed.value = next
      void press()
    },
  })
  return { context: computed(() => pressed.value?.name ?? ''), finished, panel }
}

/** The opener of the list a row stands in. */
export function useRowOpen(): RowOpen {
  const opener = inject(ROW_OPEN, null)
  if (opener === null) throw new Error('A row opens its session only inside the list')
  return opener
}
