/** Neutral activity projection consumed by the application shell. */

import {
  invalid,
  isoDate,
  plainObject,
  requiredString,
} from '@/shared/api/platformRelationGuards.ts'

const ACTIVITY_ACTION = /^[a-z][a-z0-9_-]{0,63}$/u
const WORK_ITEM_REFERENCE = /^[A-Z][A-Z0-9]{1,7}-[1-9]\d{0,8}$/u
const MAX_ACTIVITY_ROWS = 500

/**
 * One lifecycle event, as the shell shows it.
 *
 * The Board era shipped the Kernel refs inside the row, so the store had to know
 * which project a project-agnostic table belonged to. The row now carries the
 * work item reference and nothing else about identity; pairing it with a project
 * is the shell's job, and it refuses when the pairing is not exact.
 */
export type PlatformActivity = {
  activity_id: number
  actor: string
  observed_at: string
  reference: string
  /** The category of the state a transition reached; absent for other actions. */
  state_category: string | null
  status: string
  summary: string
  title: string
}

/** The space key a reference belongs to, which is its prefix. */
export function activitySpaceKey(item: PlatformActivity): string {
  return item.reference.split('-')[0]
}

function presentationText(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string') invalid(path, 'expected string')
  const trimmed = value.trim()
  if (trimmed.length > maxLength) invalid(path, `expected at most ${maxLength} characters`)
  return trimmed
}

function validateActivityRow(value: unknown, path: string): PlatformActivity {
  const object = plainObject(value, path)
  const allowed = new Set([
    'event_id',
    'work_item_id',
    'reference',
    'title',
    'action',
    'detail',
    'state_category',
    'author',
    'at',
  ])
  for (const key of Object.keys(object))
    if (!allowed.has(key)) invalid(`${path}.${key}`, 'unknown field')
  for (const key of allowed) if (!(key in object)) invalid(`${path}.${key}`, 'missing field')
  if (!Number.isSafeInteger(object.event_id) || (object.event_id as number) <= 0)
    invalid(`${path}.event_id`, 'expected positive integer')
  const detail = presentationText(object.detail, `${path}.detail`, 2048)
  return {
    activity_id: object.event_id as number,
    actor: presentationText(object.author, `${path}.author`, 160),
    observed_at: isoDate(object.at, `${path}.at`),
    reference: requiredString(object.reference, `${path}.reference`, WORK_ITEM_REFERENCE, 20),
    status: requiredString(object.action, `${path}.action`, ACTIVITY_ACTION, 64),
    // A JSON detail is machine-facing; showing it raw is worse than showing
    // nothing, so the summary stays empty and the row reads by its title.
    summary: detail.startsWith('{') || detail.startsWith('[') ? '' : detail,
    title: presentationText(object.title, `${path}.title`, 240),
    state_category:
      object.state_category === null
        ? null
        : requiredString(object.state_category, `${path}.state_category`, ACTIVITY_ACTION, 32),
  }
}

export function validatePlatformActivityPayload(value: unknown): PlatformActivity[] {
  if (!Array.isArray(value)) invalid('activity', 'expected array')
  if (value.length > MAX_ACTIVITY_ROWS)
    invalid('activity', `expected at most ${MAX_ACTIVITY_ROWS} rows`)
  return value.map((entry, index) => validateActivityRow(entry, `activity[${index}]`))
}
