import { ref } from 'vue'
import type { Ref } from 'vue'

import {
  fetchExecutionCapabilities,
  fetchExecutionHistory,
  fetchExecutionUsage,
  launchWorkItem,
  stopLaunch,
} from '@/shared/api/executionApi.ts'
import type {
  Execution,
  ExecutionCapabilities,
  ExecutionUsage,
} from '@/shared/api/executionModel.ts'
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
 */
export function useWorkItemExecutions(
  reference: () => string,
  busy: Ref<boolean>,
  onChanged: () => Promise<void>,
) {
  const executions = ref<readonly Execution[]>([])
  const error = ref('')
  const loading = ref(false)
  const capabilities = ref<ExecutionCapabilities | null>(null)
  const usage = ref<ExecutionUsage | null>(null)
  const usageError = ref('')
  const usageLoading = ref(false)
  const launchOpen = ref(false)
  const launchError = ref('')

  // A serial rather than a cancellation: a slow answer for the item that was
  // open a moment ago must not overwrite the one that is open now.
  let serial = 0

  async function load() {
    const mine = ++serial
    loading.value = true
    error.value = ''
    try {
      const payload = await fetchExecutionHistory(reference())
      if (mine !== serial) return
      executions.value = payload.executions
      void readUsage(payload.executions[0]?.execution_id ?? '', mine)
    } catch (error_) {
      if (mine !== serial) return
      executions.value = []
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      if (mine === serial) loading.value = false
    }
  }

  /**
   * The newest attempt's cost, read after the history that names it.
   *
   * Separate from the history because it opens journal files on disk: the list
   * of attempts is what the section opens with, and the cost of one of them is
   * a second question with a second answer.
   */
  async function readUsage(executionId: string, generation: number) {
    if (!executionId) {
      usage.value = null
      usageError.value = ''
      return
    }
    usageLoading.value = true
    usageError.value = ''
    try {
      const answer = await fetchExecutionUsage(executionId)
      if (generation !== serial) return
      usage.value = answer
    } catch (error_) {
      if (generation !== serial) return
      usage.value = null
      usageError.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      if (generation === serial) usageLoading.value = false
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

  return {
    capabilities,
    error,
    executions,
    usage,
    usageError,
    usageLoading,
    launchError,
    launchOpen,
    load,
    loading,
    openLaunch,
    start,
    stop,
  }
}
