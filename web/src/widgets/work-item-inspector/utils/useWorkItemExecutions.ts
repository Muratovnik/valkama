import { ref, watch } from 'vue'
import type { Ref } from 'vue'

import {
  fetchExecutionCapabilities,
  fetchExecutionHistory,
  launchWorkItem,
  stopLaunch,
} from '@/shared/api/executionApi.ts'
import type { Execution, ExecutionCapabilities } from '@/shared/api/executionModel.ts'
import type { LaunchPacket } from '@/shared/types/launch.ts'

/**
 * The attempts at one work item, and the two writes that change them.
 *
 * Kept out of the inspector component because it is a second read with a second
 * owner: the item is Planning's record and the attempts are the execution
 * module's, so they load separately, fail separately, and a failure in one must
 * not blank the other. Joining them into a single payload would also make every
 * work-item read carry a launch history that most screens never show.
 *
 * `busy` is the inspector's, not this composable's. A launch and a transition
 * are both writes on the same item, and two independent busy flags would let an
 * operator start one while the other was still in flight.
 *
 * `readFor` says when to read: a key that changes for every answer worth a new
 * read, and is empty while there is nothing to ask about. The card keys it on
 * an item its read found, so a reference that names nothing is never asked
 * about — a stale link used to send the execution module two requests for a
 * record that does not exist.
 */
export function useWorkItemExecutions(
  reference: () => string,
  busy: Ref<boolean>,
  onChanged: () => Promise<void>,
  readFor: () => string,
) {
  const executions = ref<readonly Execution[]>([])
  const error = ref('')
  const loading = ref(false)
  const capabilities = ref<ExecutionCapabilities | null>(null)
  const launchOpen = ref(false)
  const launchError = ref('')

  // A serial rather than a cancellation: a slow answer for the item that was
  // open a moment ago must not overwrite the one that is open now.
  let serial = 0
  /** The item whose attempts are on screen, so a read of the same item is a refresh. */
  let shown = ''

  /**
   * Read the attempts. The first read of an item says it is loading; every
   * later one is a refresh and leaves the list drawn until its answer lands.
   * It is re-read on every refresh of the card, and it used to replace the list
   * with "Loading…" each time, so the section collapsed to one line and grew
   * back under the operator. A refresh that fails keeps the last answer: the
   * next refresh asks again, as a chain's does.
   */
  async function load() {
    const mine = ++serial
    const asked = reference()
    const first = asked !== shown
    if (first) {
      loading.value = true
      error.value = ''
    }
    try {
      const payload = await fetchExecutionHistory(asked)
      if (mine !== serial) return
      executions.value = payload.executions
      error.value = ''
      shown = asked
    } catch (error_) {
      if (mine !== serial || !first) return
      executions.value = []
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      if (mine === serial) loading.value = false
    }
  }

  /** Read when the dialog opens: what a client accepts does not change while it is. */
  async function openLaunch() {
    launchError.value = ''
    launchOpen.value = true
    try {
      capabilities.value = await fetchExecutionCapabilities(reference())
    } catch (error_) {
      launchError.value = error_ instanceof Error ? error_.message : String(error_)
    }
  }

  async function start(packet: LaunchPacket, refused: (message: string) => string) {
    if (busy.value) return
    busy.value = true
    launchError.value = ''
    try {
      const answer = await launchWorkItem(packet)
      if ('error' in answer) {
        // A refusal is an answer: the packet was not startable and the item is
        // exactly as it was, so the dialog stays open with the reason in it.
        launchError.value = refused(answer.message)
        return
      }
      launchOpen.value = false
      await Promise.all([load(), onChanged()])
    } catch (error_) {
      launchError.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      busy.value = false
    }
  }

  async function stop() {
    if (busy.value) return
    busy.value = true
    try {
      await stopLaunch(reference())
      await Promise.all([load(), onChanged()])
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      busy.value = false
    }
  }

  watch(
    readFor,
    (key) => {
      if (key) void load()
    },
    { immediate: true },
  )

  return {
    capabilities,
    error,
    executions,
    launchError,
    launchOpen,
    loading,
    openLaunch,
    start,
    stop,
  }
}
