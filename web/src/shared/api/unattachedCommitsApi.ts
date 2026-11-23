/**
 * The commits a session made that no card holds: `GET /api/planning/commits/unattached`, read by
 * a space's projects, by one project, or with neither for the whole store, newest first; and the
 * person's attach of one of them to a card, `POST /api/planning/work-item/commit`.
 *
 * The attach takes the card's reference, the repository and the hash, and nothing else: no
 * author, since a write from the interface is the person's. A refusal comes as the planning
 * boundary throws it (`planningRefusal`), in the server's words.
 */
import { commitSchema as attachedCommitSchema } from '@/shared/api/commitModel.ts'
import { boundedText, parseContract, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { request } from '@/shared/api/planningApi.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { callField } from '@/shared/api/planningText.ts'
import { enumField, invalid, ISO, PROJECT_ID } from '@/shared/api/platformApiGuards.ts'

/** The most commits the list answers in one read. */
const UNATTACHED_MOST = 500

const commitSchema = strictObject({
  repository: boundedText(PROJECT_ID, 160).nullable(),
  display_name: boundedText(/^[^\u{0}]{1,200}$/u, 200).nullable(),
  hash: boundedText(/^[0-9a-f]{7,64}$/u, 64),
  subject: z.string().max(10_000),
  committed_at: boundedText(/^\d{4}-\d{2}-\d{2}T[^\s]{1,80}$/u, 96).nullable(),
  session: callField(),
  agent: callField(),
  client: enumField(['claude', 'codex'] as const),
  reported_at: boundedText(ISO, 96),
})

const listSchema = strictObject({
  total: positiveInt(true),
  items: z.array(commitSchema).max(UNATTACHED_MOST),
})

export type UnattachedCommit = z.infer<typeof commitSchema>
export type UnattachedCommits = z.infer<typeof listSchema>

/** Whose commits are read: a space's projects by its key, one project, or the whole store. */
export interface UnattachedScope {
  project: string | null
  space: string | null
}

/** The commits on no card of a scope, the newest first, with how many there are in all. */
export async function readUnattachedCommits(
  scope: UnattachedScope,
  signal?: AbortSignal,
): Promise<UnattachedCommits> {
  const search = new URLSearchParams({ limit: String(UNATTACHED_MOST) })
  if (scope.project !== null) search.set('project', scope.project)
  else if (scope.space !== null) search.set('space', scope.space)
  const payload = await request(`/api/planning/commits/unattached?${search}`, { signal })
  return parseContract(listSchema, payload, 'planning.commits.unattached', invalid)
}

/**
 * The card at its revision, the commit as its record lists it now, and whether anything changed.
 * A card nobody wrote to since it was filed stands at revision 0, as every revision a card reads.
 */
const attachedSchema = strictObject({
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  revision: positiveInt(true),
  commit: attachedCommitSchema.nullable(),
  changed: z.boolean(),
})

/** The answer of an attach, as the strict schema reads it. */
export const validateAttachedCommit = (payload: unknown) =>
  parseContract(attachedSchema, payload, 'planning.work-item.commit', invalid)

/** Attach a commit to the card `reference`; whether the write changed anything. */
export async function attachCommit(input: {
  hash: string
  reference: string
  repository: string | null
}): Promise<boolean> {
  const body = {
    reference: input.reference,
    hash: input.hash,
    ...(input.repository === null ? {} : { repository: input.repository }),
  }
  const payload = await request('/api/planning/work-item/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return validateAttachedCommit(payload).changed
}
