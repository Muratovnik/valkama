/**
 * HTTP ownership for executions: what may be launched, what has run, and attaching.
 *
 * The launch and stop calls move here from `api.ts` so every route that starts,
 * ends or reads an attempt is in one file. Their answers keep the shape they
 * had — a 422 is the runner refusing, not a transport failure — and the three
 * reads validate before a view sees them.
 */

import {
  validateAttached,
  validateCapabilities,
  validateHistory,
  validateUsage,
} from '@/shared/api/executionModel.ts'
import type {
  ExecutionCapabilities,
  ExecutionHistory,
  ExecutionUsage,
} from '@/shared/api/executionModel.ts'
import { secureFetch } from '@/shared/api/secureFetch.ts'
import type {
  LaunchPacket,
  LaunchRefused,
  LaunchStarted,
  LaunchStopped,
} from '@/shared/types/launch.ts'

async function read(input: string): Promise<unknown> {
  const response = await secureFetch(input)
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return response.json()
}

async function write(input: string, body: unknown): Promise<Response> {
  return secureFetch(input, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * What each client accepts, whether it is installed, and where an attempt at the
 * named item would run. The reference is optional because the answer about the
 * clients does not depend on it; only the suggested directory does.
 */
export async function fetchExecutionCapabilities(
  reference?: string,
): Promise<ExecutionCapabilities> {
  const query = reference ? `?work_item=${encodeURIComponent(reference)}` : ''
  return validateCapabilities(await read(`/api/execution/capabilities${query}`))
}

/**
 * What one attempt cost, from whatever local source observed it.
 *
 * Its own read rather than a field on the history: it opens journal files on
 * disk, and a reader who never opens the Usage section never pays for it.
 */
export async function fetchExecutionUsage(executionId: string): Promise<ExecutionUsage> {
  return validateUsage(
    await read(`/api/execution/usage?execution_id=${encodeURIComponent(executionId)}`),
  )
}

/** Every attempt at one work item, newest first. */
export async function fetchExecutionHistory(reference: string): Promise<ExecutionHistory> {
  return validateHistory(
    await read(`/api/execution/history?work_item=${encodeURIComponent(reference)}`),
  )
}

/**
 * Start a work item on an agent. A 422 is the runner refusing, not a transport
 * error: the packet was not startable and the item is exactly as it was.
 */
export async function launchWorkItem(packet: LaunchPacket): Promise<LaunchStarted | LaunchRefused> {
  const response = await write('/api/execution/launch', packet)
  if (response.status === 422) return (await response.json()) as LaunchRefused
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as LaunchStarted
}

/** Stop a launch this process owns; the item keeps its claim and its history. */
export async function stopLaunch(reference: string): Promise<LaunchStopped | LaunchRefused> {
  const response = await write('/api/execution/stop', { work_item: reference })
  if (response.status === 422) return (await response.json()) as LaunchRefused
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return (await response.json()) as LaunchStopped
}

/**
 * Record that an observed session belongs to a work item, because a person said
 * so. There is no automatic version of this call by design: matching a session
 * to work by time, by directory or by whichever journal is newest is a guess
 * that is wrong exactly when it matters.
 */
export async function attachSession(reference: string, sessionId: string): Promise<string> {
  const response = await write('/api/execution/attach', {
    work_item: reference,
    session_id: sessionId,
  })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return validateAttached(await response.json()).execution_id
}
