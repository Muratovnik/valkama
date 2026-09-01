import type { PlanningActivityEntry, WorkflowState } from '@/shared/api/planningModel.ts'
import type { NotifyEvent, PlatformSettings } from '@/shared/lib/settings'
import type { AgentSession } from '@/shared/types/session.ts'

/**
 * The one decision layer for owner notifications. The page owns the live
 * streams, so it decides which pushes deserve a toast; delivery is a detail
 * behind it (the desktop bridge when present, the web Notification API
 * otherwise). Everything here is pure so the decisions stay testable.
 */

export interface ToastRequest {
  body: string
  event: NotifyEvent
  /** Stable identity of the reason, so one reason cannot toast twice. */
  key: string
  title: string
  planningSpace?: string
  workItem?: string
}

export type Translate = (key: string, params?: Record<string, unknown>) => string

/** Sixteen parallel agents finishing at once must not raise sixteen toasts. */
export const MAX_TOASTS_PER_PUSH = 3

/**
 * Which state categories are worth a toast.
 *
 * Keyed by category, not by state name: the Board era matched the three lane
 * names, so a space that called its review state something else stopped
 * notifying entirely and nothing said so.
 */
const CATEGORY_EVENTS: Partial<Record<WorkflowState['category'], NotifyEvent>> = {
  completed: 'itemCompleted',
  review: 'itemInReview',
  blocked: 'itemBlocked',
}

function clip(value: string, limit = 110): string {
  const text = (value ?? '').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function summaryToast(hidden: number, t: Translate): ToastRequest {
  return {
    key: 'summary',
    event: 'itemCompleted',
    title: 'Valkama',
    body: t('notify.more', { count: hidden }),
  }
}

export interface ActivityDecision {
  baseline: number
  toasts: ToastRequest[]
}

/**
 * Work-item lifecycle toasts from the activity feed. The first payload only
 * sets the baseline: history must never replay as if it just happened.
 */
export function activityToasts(
  items: PlanningActivityEntry[],
  baseline: number | null,
  settings: PlatformSettings,
  t: Translate,
): ActivityDecision {
  let top = 0
  for (const item of items) top = Math.max(top, item.event_id)
  if (baseline === null || !settings.notifyEnabled) {
    return { toasts: [], baseline: top }
  }
  const fresh = items
    .filter((item) => item.event_id > baseline && item.action === 'transitioned')
    .map((item) => ({
      item,
      event: item.state_category ? CATEGORY_EVENTS[item.state_category] : undefined,
    }))
    .filter(
      (entry): entry is { event: NotifyEvent; item: PlanningActivityEntry } =>
        entry.event !== undefined,
    )
    .filter((entry) => settings.notify[entry.event])
    // The feed arrives newest first; toasts read better oldest first.
    .sort((left, right) => left.item.event_id - right.item.event_id)
  const shown = fresh.slice(0, MAX_TOASTS_PER_PUSH)
  const toasts: ToastRequest[] = shown.map(({ item, event }) => {
    const headline = t(`notify.${event}`)
    return {
      key: `activity-${item.event_id}`,
      event,
      title: `${headline} · ${item.reference}`,
      body: clip(item.title),
      planningSpace: item.reference.split('-')[0],
      workItem: item.reference,
    }
  })
  if (fresh.length > shown.length) toasts.push(summaryToast(fresh.length - shown.length, t))
  return { toasts, baseline: top }
}

/** What of one session the decision layer must remember between pushes. */
function signature(session: AgentSession): string {
  return `${session.status}|${session.attention}|${session.attention_seen ? 1 : 0}`
}

function sessionName(session: AgentSession): string {
  if (session.label) return session.label
  const parts = session.cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts.at(-1) || session.id.slice(0, 8)
}

const ATTENTION_EVENTS: Record<string, NotifyEvent> = {
  waiting: 'agentWaiting',
  blocked: 'agentBlocked',
}

/** An active session seen to stop, whether it failed or ended cleanly. */
function stoppedToast(
  session: AgentSession,
  settings: PlatformSettings,
  t: Translate,
): ToastRequest | null {
  const event: NotifyEvent = session.status === 'failed' ? 'sessionFailed' : 'sessionEnded'
  if (!settings.notify[event]) return null
  const headline = t(`notify.${event}`)
  return {
    key: `session-${session.id}-${session.status}`,
    event,
    title: `${headline} · ${session.client}`,
    body: clip(sessionName(session)),
    workItem: session.work_item ?? undefined,
  }
}

/** A still-running session that started asking for something, once. */
function attentionToast(
  session: AgentSession,
  settings: PlatformSettings,
  t: Translate,
): ToastRequest | null {
  const event = ATTENTION_EVENTS[session.attention]
  if (session.status !== 'active' || !event) return null
  if (session.attention_seen || !settings.notify[event]) return null
  const headline = t(`notify.${event}`)
  return {
    key: `session-${session.id}-${session.attention}`,
    event,
    title: `${headline} · ${session.client}`,
    body: clip(sessionName(session)),
    workItem: session.work_item ?? undefined,
  }
}

export interface SessionDecision {
  known: Map<string, string>
  toasts: ToastRequest[]
}

/**
 * Session toasts from status transitions the page just observed. A session
 * appearing already-ended is history, not news; only an active session seen
 * to end (or to start ringing) notifies.
 */
export function sessionToasts(
  sessions: AgentSession[],
  known: Map<string, string> | null,
  settings: PlatformSettings,
  t: Translate,
): SessionDecision {
  const next = new Map(sessions.map((session) => [session.id, signature(session)]))
  if (known === null || !settings.notifyEnabled) return { toasts: [], known: next }
  const fresh: ToastRequest[] = []
  for (const session of sessions) {
    const before = known.get(session.id)
    if (before === undefined || before === signature(session)) continue
    const [previousStatus] = before.split('|')
    // A session seen to stop is reported as having stopped, and its attention
    // flag is not news on top of that.
    const stopped = previousStatus === 'active' && session.status !== 'active'
    const toast = stopped
      ? stoppedToast(session, settings, t)
      : attentionToast(session, settings, t)
    if (toast) fresh.push(toast)
  }
  const shown = fresh.slice(0, MAX_TOASTS_PER_PUSH)
  if (fresh.length > shown.length) shown.push(summaryToast(fresh.length - shown.length, t))
  return { toasts: shown, known: next }
}

const INBOX_EVENTS: Record<string, NotifyEvent> = {
  ended: 'sessionEnded',
  failed: 'sessionFailed',
  waiting: 'agentWaiting',
  blocked: 'agentBlocked',
}

/**
 * Older desktop shells raise their own toasts from the reported inbox. They
 * must still obey the owner's settings, so the page filters what it reports.
 */
export function filterInbox<T extends { attention: string }>(
  inbox: T[],
  settings: PlatformSettings,
): T[] {
  if (!settings.notifyEnabled) return []
  return inbox.filter((item) => settings.notify[INBOX_EVENTS[item.attention] ?? 'agentBlocked'])
}

/** The toast shape the desktop bridge accepts. */
export interface DesktopToast {
  body: string
  key: string
  title: string
  planning_space?: string
  work_item?: string
}

export function toDesktopToasts(toasts: ToastRequest[]): DesktopToast[] {
  return toasts.map((toast) => ({
    key: toast.key,
    title: toast.title,
    body: toast.body,
    planning_space: toast.planningSpace,
    work_item: toast.workItem,
  }))
}
