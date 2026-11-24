/**
 * The owner's space window: three reads and one write (`docs/connection-contract.md`, «The
 * owner's space window»).
 *
 * The write creates, edits or removes one space of the main store together with the projects
 * the registry binds to it. The store and the registry have no shared transaction, so the
 * answer says what became of the registry's part: written, unchanged, or refused after a
 * creation or a rename the store kept. A refusal of the whole save names its code, and a
 * refusal by the registry also names the registry's own reason, which the window says in the
 * reader's language.
 */

import {
  boundedList,
  boundedText,
  parseContract,
  positiveInt,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { spaceRecordSchema } from '@/shared/api/planningModel.ts'
import { SPACE_KEY, TITLE } from '@/shared/api/planningSpaceModel.ts'
import { serverText } from '@/shared/api/planningText.ts'
import { enumField, PROJECT_ID, UUID } from '@/shared/api/platformApiGuards.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'
import { WEB_AUTHOR } from '@/shared/api/webAuthor.ts'

const CODE = /^[a-z_]{1,64}$/u
const ROOT = /^[^\u{0}]{1,32767}$/u

const spaceRefSchema = strictObject({
  data_scope_id: boundedText(UUID, 36),
  space_key: boundedText(SPACE_KEY, 8),
})

const projectsSchema = strictObject({
  registry: strictObject({
    status: enumField(['available', 'absent', 'unavailable', 'malformed'] as const),
    reason: z.string(),
  }),
  projects: boundedList(
    strictObject({
      project_id: boundedText(PROJECT_ID, 160),
      display_name: boundedText(TITLE, 200),
      root: boundedText(ROOT, 32_767),
      /** The space the registry binds it to, in whichever store; null for none. */
      space: spaceRefSchema.nullable(),
      default: z.boolean(),
    }),
    10_000,
  ),
})

const refusalShape = strictObject({ code: boundedText(CODE, 64), message: serverText() })

const keySchema = strictObject({
  key: boundedText(SPACE_KEY, 8).nullable(),
  refusal: refusalShape.nullable(),
})

const formSchema = strictObject({
  space: strictObject({
    name: boundedText(TITLE, 200),
    key: boundedText(SPACE_KEY, 8),
    /** The space has issued a number, so its key is in them and does not change. */
    key_locked: z.boolean(),
    work_items: positiveInt(true),
  }).nullable(),
  workflow: strictObject({ name: boundedText(TITLE, 200), states: positiveInt() }),
})

const savedSchema = strictObject({
  operation: enumField(['created', 'edited', 'removed'] as const),
  space: spaceRecordSchema.nullable(),
  space_ref: spaceRefSchema.nullable(),
  registry: strictObject({
    status: enumField(['written', 'unchanged', 'refused'] as const),
    reason: boundedText(CODE, 64).optional(),
    message: serverText().optional(),
  }),
})

/** The shape a refused save answers with: a registry refusal adds the registry's reason. */
const saveRefusalSchema = strictObject({
  error: strictObject({
    code: boundedText(CODE, 64),
    message: serverText(),
    reason: boundedText(CODE, 64).optional(),
  }),
})

export type RegisteredProjects = z.infer<typeof projectsSchema>
export type RegisteredProject = RegisteredProjects['projects'][number]
export type DerivedKey = z.infer<typeof keySchema>
export type SpaceForm = z.infer<typeof formSchema>
export type SpaceSaved = z.infer<typeof savedSchema>

/** A project the save registers before it joins the space. */
export interface NewProject {
  canonical_root: string
  display_name: string
  project_id: string
}

/** A creation, without `space`, or an edit of the space it names: the whole draft. */
export interface SpaceEdit {
  key: string
  name: string
  new_projects: NewProject[]
  projects: { default: boolean; project_id: string }[]
  space?: PlanningSpaceRef
}

/** What the window sends: a creation or an edit, or a removal. */
export type SpaceSave = SpaceEdit | { remove: true; space: PlanningSpaceRef }

/** The server refused the save, or an answer broke the contract. */
class SpaceWindowError extends Error {
  readonly code: string
  /** The registry's own reason, where it was the registry that refused. */
  readonly reason: string | null
  readonly status: number | null

  constructor(code: string, status: number | null, message: string, reason: string | null) {
    super(message)
    this.name = 'SpaceWindowError'
    this.code = code
    this.status = status
    this.reason = reason
  }
}

function invalid(path: string, detail: string): never {
  throw new SpaceWindowError('space_window_contract_invalid', null, `${path}: ${detail}`, null)
}

/** Why a save or a read did not go through: the server's code, its reason and its words. */
export interface SpaceWindowRefusal {
  code: string
  message: string
  reason: string | null
}

/** The refusal an error carries, or null for a failure that is not the server's answer. */
export function spaceWindowRefusal(error: unknown): SpaceWindowRefusal | null {
  return !(error instanceof SpaceWindowError) || error.status === null
    ? null
    : { code: error.code, message: error.message, reason: error.reason }
}

async function request(input: string, init?: RequestInit): Promise<unknown> {
  const { response, payload } = await readJsonResponse(input, init)
  if (response.ok) return payload
  const refusal = saveRefusalSchema.safeParse(payload)
  if (refusal.success) {
    const { code, message, reason = null } = refusal.data.error
    throw new SpaceWindowError(code, response.status, message, reason)
  }
  throw new SpaceWindowError('request_failed', response.status, `HTTP ${response.status}`, null)
}

/** Every registered project and the space each is in, those in none included. */
export async function fetchRegisteredProjects(): Promise<RegisteredProjects> {
  const answer = await request('/api/planning/projects')
  return parseContract(projectsSchema, answer, 'projects', invalid)
}

/** The key the server would give a new space of this name, or why it gives none. */
export async function fetchDerivedKey(name: string, signal?: AbortSignal): Promise<DerivedKey> {
  const answer = await request(`/api/planning/space/key?${new URLSearchParams({ name })}`, {
    signal,
  })
  return parseContract(keySchema, answer, 'key', invalid)
}

/** A space's name, key and whether they may change; with no key, a new space's workflow. */
export async function fetchSpaceForm(key: string | null): Promise<SpaceForm> {
  const query = key === null ? '' : `?${new URLSearchParams({ space: key })}`
  const answer = await request(`/api/planning/space/form${query}`)
  return parseContract(formSchema, answer, 'form', invalid)
}

/** One save of the window: the store's part and the registry's, as the answer says. */
export async function saveSpace(save: SpaceSave): Promise<SpaceSaved> {
  const answer = await request('/api/planning/space/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...save, author: WEB_AUTHOR }),
  })
  return parseContract(savedSchema, answer, 'saved', invalid)
}
