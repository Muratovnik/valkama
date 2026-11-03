import type { AlertCheck, AlertStatus, AlertTrial } from '@/shared/api/alertsApi.ts'

/** Every answer the readiness row can give; each code has its words in `alerts.readiness`. */
type AlertReadinessCode =
  | 'ready'
  | 'no-shortcut'
  | 'disabled-for-application'
  | 'disabled-for-user'
  | 'disabled-by-group-policy'
  | 'disabled-by-manifest'
  | 'switched-off'
  | 'unsupported'
  | 'unavailable'
  | 'failed'

export interface AlertReadiness {
  code: AlertReadinessCode
  /** Why, in the server's words, where only the server can say. */
  reason: string | null
  /** The `integration-health` state that colours it. */
  state: 'ready' | 'unavailable' | 'degraded' | 'not-observed'
}

const WINDOWS_ANSWERS: Readonly<Record<string, AlertReadinessCode>> = {
  'enabled': 'ready',
  'no-shortcut': 'no-shortcut',
  'disabled-for-application': 'disabled-for-application',
  'disabled-for-user': 'disabled-for-user',
  'disabled-by-group-policy': 'disabled-by-group-policy',
  'disabled-by-manifest': 'disabled-by-manifest',
  'switched-off': 'switched-off',
  'unsupported': 'unsupported',
  'unavailable': 'unavailable',
}

const STATE_OF: Readonly<Record<AlertReadinessCode, AlertReadiness['state']>> = {
  'ready': 'ready',
  // Windows will drop the toast: nothing reaches the owner until the cause is fixed.
  'no-shortcut': 'unavailable',
  'disabled-for-application': 'unavailable',
  'disabled-for-user': 'unavailable',
  'disabled-by-group-policy': 'unavailable',
  'disabled-by-manifest': 'unavailable',
  'unavailable': 'unavailable',
  // Whether a toast would show is not known, which is not the same as no.
  'failed': 'degraded',
  // No toast by design of this machine or process, so there is nothing to repair.
  'switched-off': 'not-observed',
  'unsupported': 'not-observed',
}

/** A state this build has no words for is a failed check, not a working one. */
export function readinessOfCheck(check: AlertCheck): AlertReadiness {
  const code = WINDOWS_ANSWERS[check.state] ?? 'failed'
  return { code, state: STATE_OF[code], reason: check.reason }
}

/**
 * One state at a time, the one to fix first. A missing shortcut comes before what
 * Windows says about it, because Windows has settings for an app only once the
 * shortcut names it; a process that shows nothing on purpose comes before both.
 */
export function readinessOfStatus(status: AlertStatus): AlertReadiness {
  const windows = readinessOfCheck(status.windows)
  return windows.state === 'not-observed' || status.shortcut
    ? windows
    : { code: 'no-shortcut', state: STATE_OF['no-shortcut'], reason: null }
}

/** Windows would show it, and the helper that shows it did not start. */
export function readinessOfTrial(trial: AlertTrial, notStarted: string): AlertReadiness {
  const answer = readinessOfCheck(trial)
  return answer.code === 'ready' && !trial.shown ? failedReadiness(notStarted) : answer
}

/** A check that could not be read at all. */
export function failedReadiness(reason: string): AlertReadiness {
  return { code: 'failed', state: STATE_OF.failed, reason }
}
