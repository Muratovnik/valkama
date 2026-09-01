/** Runtime contracts for the session monitor wire surface. */

import { fromValidator, parseContract, strictObject, z } from '@/shared/api/contract.ts'
import { validateEntityRef } from '@/shared/api/platformEntityRef.ts'
import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'
import type { SessionFeed, SessionsPayload } from '@/shared/types/session.ts'

const text = (max = 4096) => z.string().max(max)
const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), { message: 'expected timestamp' })

function validatePlanningSpaceEntity(value: unknown, path: string): PlanningSpaceEntityRef {
  const entity = validateEntityRef(value, path)
  if (entity.kind !== 'planning-space') invalid(path, 'expected planning-space resource_ref')
  planningSpaceRef(entity)
  return entity as PlanningSpaceEntityRef
}

const spaceRootSchema = strictObject({
  canonical_root: text().nullable(),
  effective_cwd: text().optional(),
  fallback: z.boolean().optional(),
  reason: text(),
  resource_ref: fromValidator(validatePlanningSpaceEntity).nullable(),
  session_cwd: text().optional(),
  source: text().optional(),
  status: z.enum(['mapped', 'missing', 'ambiguous', 'malformed', 'unavailable']),
  validated: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.status === 'mapped' && value.resource_ref === null) {
    context.addIssue({
      code: 'custom',
      message: 'mapped root requires canonical planning-space resource_ref',
      path: ['resource_ref'],
    })
  }
  if (value.status === 'mapped' && value.canonical_root === null) {
    context.addIssue({
      code: 'custom',
      message: 'mapped root requires canonical_root',
      path: ['canonical_root'],
    })
  }
})

const sessionSchema = strictObject({
  adapter_id: text(240).optional(),
  attention: text(240),
  attention_seen: z.boolean(),
  client: text(240),
  client_family: z.enum(['codex', 'claude', 'other']).optional(),
  current_step: text(),
  cwd: text(),
  ended_at: timestamp.nullable(),
  execution_id: text(240).optional(),
  id: text(240),
  label: text(512),
  last_seen: timestamp,
  presence: z.enum(['connected', 'stale', 'terminal']).optional(),
  quiet_seconds: z.number().int().nonnegative(),
  scope: text(240).optional(),
  space_root: spaceRootSchema.optional(),
  started_at: timestamp,
  status: z.enum(['active', 'ended', 'failed']),
  work_item: text(240).nullable(),
})

const sessionsSchema = strictObject({
  inbox: z.array(sessionSchema).max(10_000),
  sessions: z.array(sessionSchema).max(10_000),
})

const eventSchema = strictObject({
  at: timestamp,
  detail: text(65_536),
  id: z.number().int().nonnegative(),
  kind: text(240),
  klass: z.enum(['analytics', 'stream']),
  server: text(240),
  status: text(240),
  tool: text(240),
})

const feedSchema = strictObject({
  events: z.array(eventSchema).max(5000),
  session: text(240),
})

function invalid(path: string, detail: string): never {
  throw new Error(`${path}: ${detail}`)
}

/** Reject malformed or version-skewed session snapshots before they reach Vue state. */
export function validateSessionsPayload(value: unknown): SessionsPayload {
  return parseContract(sessionsSchema, value, 'sessions', invalid) as SessionsPayload
}

/** Reject malformed feed rows before they are rendered as operational history. */
export function validateSessionFeed(value: unknown): SessionFeed {
  return parseContract(feedSchema, value, 'session_feed', invalid) as SessionFeed
}
