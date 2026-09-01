/**
 * What an attempt is on the wire, and what a client will accept before one starts.
 *
 * Two payloads, and they answer different questions. `capabilities` is what a
 * launch may be asked for — per client, because the clients do not agree — and
 * `history` is what has already run. The launch form is built from the first so
 * it stops offering a client an option that client refuses, which is what a
 * hard-coded list did.
 *
 * Strict, like every other read model here: a field the server sends and this
 * file does not name is a load failure rather than a silent omission. Layer 1
 * shipped a mock that agreed with the client instead of with the server, and
 * only a live screen found it.
 */

import {
  boundedList,
  boundedText,
  parseContract,
  positiveInt,
  safeText,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { invalid } from '@/shared/api/platformActionRef.ts'
import { enumField, ISO } from '@/shared/api/platformApiGuards.ts'

const EXECUTION_API = 'valkama-execution-api' as const

/** The durable lifecycle of one attempt. `attached` is a record, not a verdict. */
const EXECUTION_STATUSES = [
  'starting',
  'running',
  'complete',
  'partial',
  'refused',
  'failed',
  'cancelled',
  'attached',
] as const

/** Derived, never stored: whether this attempt is answering, asking, or done. */
const PRESENCES = ['live', 'waiting', 'terminal'] as const
const SESSION_RELATIONS = ['launched', 'resumed', 'attached'] as const
const RESULT_TRANSPORTS = ['stdout', 'file'] as const
const TELEMETRY_CONFIGURATIONS = ['environment', 'client-config', 'none'] as const
const DRIVER_HEALTH = ['ready', 'unavailable'] as const
/** How a value was obtained. A zero nobody observed is not a zero. */
const QUALITIES = ['observed', 'unknown'] as const

const NAME = /^[\w.@:+-]{1,120}$/u

/** A field that may legitimately be blank: an unset model, an empty verdict. */
function blank(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => !/\u{0}/u.test(value), { message: 'expected bounded string' })
}

/**
 * Free text that reaches a view and may be empty. A launch that never started
 * writes `delivery: ''`, so the non-empty guard alone would refuse the payload
 * the server actually sends; the union keeps that guard for every other value.
 */
function blankSafe(max: number) {
  return z.union([z.literal(''), safeText(max)])
}

const driverSchema = strictObject({
  client: boundedText(NAME, 32),
  adapter_lineage_id: boundedText(NAME, 120),
  models: boundedList(boundedText(NAME, 120), 40),
  efforts: boundedList(boundedText(NAME, 32), 20),
  exact_resume: z.boolean(),
  assigns_session_identity: z.boolean(),
  mechanical_executor: z.boolean(),
  result_transport: enumField(RESULT_TRANSPORTS),
  telemetry_configuration: enumField(TELEMETRY_CONFIGURATIONS),
  health: enumField(DRIVER_HEALTH),
  unavailable_reason: blank(400),
})

const capabilitiesSchema = strictObject({
  interface_version: z.literal(EXECUTION_API),
  drivers: boundedList(driverSchema, 20),
  roles: boundedList(boundedText(NAME, 32), 10),
  environments: boundedList(boundedText(NAME, 32), 10),
  expected_effects: boundedList(boundedText(NAME, 40), 10),
  // The empty string is a review mode: it means "not a review", and the server
  // spells it that way rather than omitting the option.
  review_modes: boundedList(blank(40), 10),
  review_verdicts: z.record(z.string(), boundedList(boundedText(NAME, 40), 10)),
  max_prompt_chars: positiveInt(),
  // Where a launch for the named item would run, according to the registry that
  // maps its space. The status travels with it so a blank field can say why.
  repository: blank(512),
  repository_status: boundedText(NAME, 32),
})

const dispositionSchema = strictObject({
  finding: blankSafe(2000),
  status: boundedText(NAME, 40),
  rationale: blankSafe(4000),
})

/**
 * The client's own verdict. Every field is optional but `outcome`, because the
 * three ways an attempt ends write three different subsets: a client that
 * reported, a launch that never started, and a stop with nothing to report.
 */
const resultSchema = strictObject({
  outcome: blank(64),
  delivery: blankSafe(16_000),
  oracle: blankSafe(16_000),
  unresolved: blankSafe(16_000),
  structured: z.boolean(),
  expected_effect: blank(64).optional(),
  review_verdict: blank(64).optional(),
  dispositions: boundedList(dispositionSchema, 100).optional(),
})

const baseArtifactSchema = strictObject({
  repository: blank(512),
  head: blank(64),
  branch: blank(200),
  dirty: z.boolean().nullable(),
  worktree: blank(512),
  quality: enumField(QUALITIES),
})

const finalArtifactSchema = strictObject({
  head: blank(64),
  branch: blank(200),
  dirty: z.boolean().nullable(),
  changed_files: positiveInt(true).nullable(),
  insertions: positiveInt(true).nullable(),
  deletions: positiveInt(true).nullable(),
  commits: boundedList(blank(64), 50),
  quality: enumField(QUALITIES),
})

const executionSessionSchema = strictObject({
  session_id: blank(128),
  relation: enumField(SESSION_RELATIONS),
  status: boundedText(NAME, 32),
  attention: blank(64),
  client: blank(32),
})

const executionSchema = strictObject({
  execution_id: boundedText(NAME, 64),
  work_item_id: blank(36),
  project_id: blank(160),
  adapter_lineage_id: blank(120),
  client_family: blank(32),
  role: blank(32),
  environment: blank(32),
  model: blank(120),
  effort: blank(32),
  expected_effect: blank(40),
  review_mode: blank(40),
  status: enumField(EXECUTION_STATUSES),
  presence: enumField(PRESENCES),
  outcome: blank(64),
  launch_id: blank(64),
  cwd: blank(512),
  resumed_from: blank(128),
  exit_code: z.number().int().nullable(),
  result: resultSchema.nullable(),
  base_artifact: baseArtifactSchema.nullable(),
  final_artifact: finalArtifactSchema.nullable(),
  started_at: boundedText(ISO, 64),
  ended_at: boundedText(ISO, 64).nullable(),
  revision: positiveInt(true),
  sessions: boundedList(executionSessionSchema, 50),
})

const historySchema = strictObject({
  interface_version: z.literal(EXECUTION_API),
  work_item: boundedText(WORK_ITEM_REFERENCE, 20),
  executions: boundedList(executionSchema, 200),
})

const attachedSchema = strictObject({
  interface_version: z.literal(EXECUTION_API),
  work_item: boundedText(WORK_ITEM_REFERENCE, 20),
  session_id: blank(128),
  execution_id: boundedText(NAME, 64),
})

/**
 * A number and how it was obtained. Never bare: a zero that was measured and a
 * zero that means nobody looked are opposite facts, and only the quality tells
 * them apart.
 */
const quantitySchema = strictObject({
  value: z.number().nullable(),
  quality: enumField(['observed', 'derived', 'estimated', 'unknown', 'unsupported']),
})

const usageSchema = strictObject({
  scope: strictObject({
    project_id: blank(160),
    work_item: boundedText(WORK_ITEM_REFERENCE, 20),
    work_item_id: blank(36),
    execution_id: boundedText(NAME, 64),
  }),
  window: strictObject({
    started_at: boundedText(ISO, 64),
    ended_at: boundedText(ISO, 64).nullable(),
  }),
  duration: strictObject({ wall_ms: quantitySchema, active_ms: quantitySchema }),
  tokens: strictObject({
    input: quantitySchema,
    cached_read: quantitySchema,
    cache_write: quantitySchema,
    output: quantitySchema,
    reasoning: quantitySchema,
    total: quantitySchema,
  }),
  cost: strictObject({ amount: quantitySchema, currency: blank(16).nullable() }),
  models: boundedList(
    strictObject({ id: blank(120), sessions: positiveInt(true), quality: blank(32) }),
    40,
  ),
  tools: boundedList(
    strictObject({
      name: blank(128),
      server: blank(128),
      calls: positiveInt(true),
      errors: positiveInt(true),
      unknown: positiveInt(true),
      quality: blank(32),
    }),
    200,
  ),
  sessions: boundedList(
    strictObject({
      session_id: blank(128),
      client: blank(32),
      observed: z.boolean(),
      reason: blankSafe(400),
    }),
    50,
  ),
  provenance: strictObject({
    adapter_id: blank(120),
    connection_id: blank(120),
    observed_at: blank(64),
    source_quality: blank(32),
  }),
  coverage: strictObject({
    time: blank(32),
    tokens: blank(32),
    cost: blank(32),
    tools: blank(32),
  }),
})

const usageEnvelopeSchema = strictObject({
  interface_version: z.literal(EXECUTION_API),
  usage: usageSchema,
})

export type ExecutionUsage = z.infer<typeof usageSchema>

export type ExecutionDriver = z.infer<typeof driverSchema>
export type ExecutionCapabilities = z.infer<typeof capabilitiesSchema>
export type Execution = z.infer<typeof executionSchema>
export type ExecutionHistory = z.infer<typeof historySchema>

export function validateCapabilities(value: unknown): ExecutionCapabilities {
  return parseContract(capabilitiesSchema, value, 'execution capabilities', invalid)
}

export function validateHistory(value: unknown): ExecutionHistory {
  return parseContract(historySchema, value, 'execution history', invalid)
}

export function validateAttached(value: unknown): z.infer<typeof attachedSchema> {
  return parseContract(attachedSchema, value, 'attached session', invalid)
}

export function validateUsage(value: unknown): ExecutionUsage {
  return parseContract(usageEnvelopeSchema, value, 'execution usage', invalid).usage
}
