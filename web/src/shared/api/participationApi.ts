/**
 * The owner's participation: where an agent's decision waits for the owner, read and written
 * one scope at a time — the shared values, or one space's — and the place a space's launches
 * run in, which is a field of the space's own record and has its own write.
 *
 * A read of a scope says, for every key, the value in force, whether the scope sets it itself
 * and what it would inherit without it; which of the four sets its points and switches are,
 * or `custom`; and the rules of every label it reads. A write changes one value, a whole set
 * or one label's rule, and answers with the read of its scope.
 */

import { boundedText, parseContract, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { workflowSchema } from '@/shared/api/planningModel.ts'
import { readRefusal } from '@/shared/api/planningRefusal.ts'
import { LAUNCH_PLACES, SPACE_KEY, spaceIdentityShape } from '@/shared/api/planningSpaceModel.ts'
import { serverText } from '@/shared/api/planningText.ts'
import { enumField } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'
import { WEB_AUTHOR } from '@/shared/api/webAuthor.ts'

/** The points at which an agent decides, each `agent` or `human`, in the order they are read. */
export const PARTICIPATION_POINTS = [
  'finding',
  'proposed_goal',
  'task_in_goal',
  'decision',
  'cancel_outside',
  'cancel_shared',
  'condition',
  'goal_close',
  'goal_defer',
] as const
/** The switches, each `on` or `off`: the queue hands out work, the reminder to triage shows. */
export const PARTICIPATION_SWITCHES = ['queue', 'triage_reminder'] as const
/** The numbers beside the points, which no set gives, with the bounds the server holds them to. */
export const PARTICIPATION_NUMBERS = {
  triage_age_days: { least: 1, most: 365 },
  triage_count: { least: 1, most: 10_000 },
  lease_quiet_days: { least: 1, most: 60 },
  recent_close_minutes: { least: 1, most: 1440 },
} as const
export const PARTICIPATION_SETS = ['minimal', 'default', 'maximal', 'manual'] as const

export type ParticipationPoint = (typeof PARTICIPATION_POINTS)[number]
export type ParticipationSwitch = (typeof PARTICIPATION_SWITCHES)[number]
export type ParticipationNumber = keyof typeof PARTICIPATION_NUMBERS
export type ParticipationKey = ParticipationPoint | ParticipationSwitch | ParticipationNumber
export type ParticipationSet = (typeof PARTICIPATION_SETS)[number]
export type Decider = 'agent' | 'human'
export type LaunchPlace = (typeof LAUNCH_PLACES)[number]

const NUMBER_KEYS = Object.keys(PARTICIPATION_NUMBERS) as ParticipationNumber[]
const LABEL = boundedText(/^[^\u{0}]{1,64}$/u, 64)
const decider = enumField(['agent', 'human'] as const)
const onOff = enumField(['on', 'off'] as const)

/** One row of a scope: its value in force, whether the scope sets it, and what it would inherit. */
const valueRow = <K extends string, V extends z.ZodTypeAny>(keys: readonly K[], value: V) =>
  strictObject({ key: enumField(keys), value, own: z.boolean(), inherited: value })

const ruleShape = { ready: z.boolean(), description: serverText().max(20_000).nullable() }

const participationSchema = strictObject({
  /** The space's key; null for the shared values. */
  scope: boundedText(SPACE_KEY, 8).nullable(),
  set: enumField([...PARTICIPATION_SETS, 'custom'] as const),
  sets: strictObject(
    Object.fromEntries(
      PARTICIPATION_SETS.map((name) => [
        name,
        strictObject(
          Object.fromEntries([
            ...PARTICIPATION_POINTS.map((key) => [key, decider]),
            ...PARTICIPATION_SWITCHES.map((key) => [key, onOff]),
          ]),
        ),
      ]),
    ),
  ),
  values: z.array(
    z.union([
      valueRow(PARTICIPATION_POINTS, decider),
      valueRow(PARTICIPATION_SWITCHES, onOff),
      valueRow(NUMBER_KEYS, positiveInt()),
    ]),
  ),
  labels: z.array(
    strictObject({
      label: LABEL,
      ...ruleShape,
      own: z.boolean(),
      inherited: strictObject(ruleShape),
    }),
  ),
})

/** A space's record as its settings write answers with it. */
const spaceRecordSchema = strictObject({ ...spaceIdentityShape, workflow: workflowSchema })

/** One key of a scope; the schema holds each kind of key to its kind of value. */
export interface ParticipationValue {
  inherited: string | number
  key: ParticipationKey
  own: boolean
  value: string | number
}
export type ParticipationLabel = z.infer<typeof participationSchema>['labels'][number]
export interface Participation {
  labels: ParticipationLabel[]
  scope: string | null
  set: ParticipationSet | 'custom'
  sets: Record<ParticipationSet, Record<string, string>>
  values: ParticipationValue[]
}

/**
 * One change of a scope, as the server takes it: a value (null to inherit again), a set
 * (null in a space takes its own points and switches away), or a label's rule (both null
 * take the rule away).
 */
export type ParticipationEdit =
  | { key: ParticipationKey; value: string | number | null }
  | { set: ParticipationSet | null }
  | { description: string | null; label: string; ready: boolean | null }
/** An edit with the scope it is made in: a space's key, or null for the shared values. */
export type ParticipationChange = { space: string | null } & ParticipationEdit

/** The server said no, in its own words, or the answer broke the contract. */
class ParticipationError extends Error {
  readonly code: string
  readonly status: number | null
  /** The server's own words for a refusal, where it gave any. */
  readonly detail: string | null

  constructor(code: string, status: number | null, detail: string | null, message = code) {
    super(message)
    this.name = 'ParticipationError'
    this.code = code
    this.status = status
    this.detail = detail
  }
}

function invalid(path: string, detail: string): never {
  throw new ParticipationError('participation_contract_invalid', null, null, `${path}: ${detail}`)
}

/** The server's words for a refused write, or null for any other failure. */
export function participationRefusal(error: unknown): string | null {
  return error instanceof ParticipationError ? error.detail : null
}

async function request(input: string, init?: RequestInit): Promise<unknown> {
  const { response, payload } = await readJsonResponse(input, init)
  if (response.ok) return payload
  const refusal = readRefusal(payload)
  if (refusal !== null)
    throw new ParticipationError(refusal.error.code, response.status, refusal.error.message)
  throw new ParticipationError('request_failed', response.status, null, `HTTP ${response.status}`)
}

function post(path: string, body: object): Promise<unknown> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function validateParticipation(value: unknown): Participation {
  return parseContract(participationSchema, value, 'participation', invalid) as Participation
}

export function validateSpaceRecord(value: unknown) {
  return parseContract(spaceRecordSchema, value, 'space', invalid)
}

/** One scope: a space by its key, or the shared values. */
export async function fetchParticipation(space: string | null): Promise<Participation> {
  const query = space === null ? '' : `?${new URLSearchParams({ space })}`
  return validateParticipation(await request(`/api/planning/participation${query}`))
}

/** Write one change; the answer is the read of the change's scope. */
export async function writeParticipation(change: ParticipationChange): Promise<Participation> {
  // The participation write names no author: it is the person's, and takes no other field.
  return validateParticipation(await post('/api/planning/participation', change))
}

/** Choose where a launch from the space's items runs; answers with the place now kept. */
export async function writeLaunchPlace(space: string, place: LaunchPlace): Promise<LaunchPlace> {
  const answer = await post('/api/planning/space/settings', {
    author: WEB_AUTHOR,
    space,
    launch_place: place,
  })
  return validateSpaceRecord(answer).launch_place
}
