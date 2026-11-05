import { watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useWorkItemExecutions } from '@/widgets/work-item-inspector/utils/useWorkItemExecutions.ts'

import type { LaunchPacket } from '@/shared/types/launch.ts'

interface ExecutionOptions {
  busy: Ref<boolean>
  changed: () => Promise<void>
  /** The card shows Execution: its tab, its attempts and the form that starts one. */
  offered: () => boolean
  /** A key that changes for every answer worth a new read, empty while there is no record. */
  readFor: () => string
  reference: () => string
}

/**
 * What a card holds of the execution module, and only while it offers it.
 *
 * Nothing but Execution and its launch form reads the attempts, so a card that does not
 * offer them asks the module nothing: an attached store's item, whose endpoints name
 * primary-store items only, and any card while the owner keeps the tab off. Turned on,
 * the key stops being empty and that is the first read.
 */
export function useInspectorExecution(options: ExecutionOptions) {
  const { t } = useI18n()

  const running = useWorkItemExecutions(options.reference, options.busy, options.changed, () =>
    options.offered() ? options.readFor() : '',
  )

  // The form stops being offered with the card's tab, and must not stand open when it returns.
  watch(options.offered, (offered) => {
    if (!offered) running.launchOpen.value = false
  })

  /** The refusal is worded here, where the catalog is, not inside the composable. */
  function submitLaunch(packet: LaunchPacket) {
    if (!options.offered()) return
    void running.start(packet, (message) => t('execution.launchFailed', { message }))
  }

  return { running, submitLaunch }
}
