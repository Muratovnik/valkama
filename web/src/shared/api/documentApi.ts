/**
 * What the server says of a path written in a text, and a Markdown file's words.
 *
 * Both reads ask, and neither answer carries an absolute path the server worked
 * out: the page holds only what `path` was sent and what `project` and `relative`
 * name, which is what it passes on to `read` and to the opener.
 */
import { parseContract, strictObject, z } from '@/shared/api/contract.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

/** The most paths one `resolve` takes; the server refuses more. */
const RESOLVE_LIMIT = 64
/**
 * The longest address one `resolve` sends. The listener answers 414 past 64 KiB of
 * request line, and 64 long or Cyrillic paths, percent-encoded, can pass that.
 */
const RESOLVE_ADDRESS_LIMIT = 65_000

const PATH_LIMIT = 1024

/**
 * What a relative path is taken from: a planning space's identity, or an open document's
 * project. `exact` is for a link read from the document's own folder, which names that
 * path under that root and nothing registered inside it.
 */
export type DocumentBase = { space?: string } | { project: string; exact?: boolean }

const sent = z.string().max(PATH_LIMIT)
const project = z.string().min(1).max(240)
const relative = z.string().min(1).max(PATH_LIMIT)
const refusedCode = z.enum(['invalid_path', 'not_a_file', 'outside_root', 'unreadable'])

const resolvedPathSchema = z.union([
  strictObject({
    path: sent,
    status: z.literal('file'),
    project,
    relative,
    markdown: z.boolean(),
  }),
  strictObject({ path: sent, status: z.literal('directory'), project, relative }),
  strictObject({ path: sent, status: z.literal('missing') }),
  strictObject({ path: sent, status: z.literal('ambiguous') }),
  strictObject({ path: sent, status: z.literal('space_unbound') }),
  strictObject({ path: sent, status: z.literal('refused'), code: refusedCode }),
])
const resolveSchema = strictObject({
  paths: z.array(resolvedPathSchema).max(RESOLVE_LIMIT),
})

const documentSchema = strictObject({
  project,
  path: relative,
  // 512 KiB of bytes the server allows, and no more characters than that.
  markdown: z.string().max(512 * 1024),
  size: z.number().int().nonnegative(),
  modified_at: z.string().max(120),
  revision: z.string().regex(/^[0-9a-f]{16}$/u),
})

/** At most this many files; the server keeps to it. */
const SEARCH_LIMIT = 20

const foundDocumentSchema = strictObject({
  path: relative,
  /** 0 when the path holds the query, otherwise the line that does. */
  line: z.number().int().nonnegative(),
  text: z.string().max(240),
})
const searchSchema = strictObject({
  documents: z.array(foundDocumentSchema).max(SEARCH_LIMIT),
})

export type ResolvedPath = z.infer<typeof resolvedPathSchema>
export type FoundDocument = z.infer<typeof foundDocumentSchema>
export type ProjectDocument = z.infer<typeof documentSchema>

const refusalSchema = strictObject({
  error: z
    .object({
      code: z.enum([
        'binary',
        'directory',
        'fetch_metadata_refused',
        'invalid_path',
        'invalid_request',
        'not_a_file',
        'not_found',
        'not_markdown',
        'not_utf8',
        'origin_refused',
        'outside_root',
        'project_unknown',
        'too_large',
        'unreadable',
      ]),
      size: z.number().int().nonnegative().optional(),
      limit: z.number().int().nonnegative().optional(),
    })
    .strict(),
})

type RefusalBody = z.infer<typeof refusalSchema>['error']

/**
 * The server answered and said no. `code` is null when what it sent was not one
 * of the refusals it promises, which a proxy or the HTTP layer itself can do.
 */
export class DocumentRefusal extends Error {
  readonly code: RefusalBody['code'] | null
  readonly limit: number | undefined
  readonly size: number | undefined
  readonly status: number

  constructor(status: number, body: RefusalBody | null) {
    super(`documents refused: ${status} ${body?.code ?? 'unknown'}`)
    this.code = body?.code ?? null
    this.limit = body?.limit
    this.size = body?.size
    this.status = status
  }
}

class DocumentContractError extends Error {
  readonly code = 'document_contract_invalid'
}

function invalid(path: string, detail: string): never {
  throw new DocumentContractError(`${path}: ${detail}`)
}

async function read(input: string, signal?: AbortSignal): Promise<unknown> {
  const { response, payload } = await readJsonResponse(input, signal ? { signal } : undefined)
  if (response.ok) return payload
  const refusal = refusalSchema.safeParse(payload)
  throw new DocumentRefusal(response.status, refusal.success ? refusal.data.error : null)
}

function resolveAddress(base: DocumentBase, paths: readonly string[]): string {
  const parameters = new URLSearchParams()
  if ('project' in base) {
    parameters.set('project', base.project)
    if (base.exact) parameters.set('exact', '1')
  } else if (base.space) parameters.set('space', base.space)
  for (const path of paths) parameters.append('path', path)
  return `/api/documents/resolve?${parameters.toString()}`
}

/** As many of these paths from the front as one `resolve` takes; never none. */
export function nextResolveBatch(base: DocumentBase, paths: readonly string[]): readonly string[] {
  const batch = paths.slice(0, RESOLVE_LIMIT)
  while (batch.length > 1 && resolveAddress(base, batch).length > RESOLVE_ADDRESS_LIMIT) batch.pop()
  return batch
}

/** A `resolve` answer, by the rules the web holds the server to. */
export function validateResolved(value: unknown) {
  return parseContract(resolveSchema, value, 'documents.resolve', invalid)
}

/** A `read` answer, by the rules the web holds the server to. */
export function validateDocument(value: unknown): ProjectDocument {
  return parseContract(documentSchema, value, 'documents.read', invalid)
}

/** A `search` answer, by the rules the web holds the server to. */
export function validateFound(value: unknown) {
  return parseContract(searchSchema, value, 'documents.search', invalid)
}

/** A refusal from any of the routes, by the closed list the server promises. */
export function validateRefusal(value: unknown): RefusalBody {
  return parseContract(refusalSchema, value, 'documents.refusal', invalid).error
}

/** The server's answer for each path, in no promised order and exactly those paths. */
export async function resolveDocuments(
  base: DocumentBase,
  paths: readonly string[],
): Promise<ResolvedPath[]> {
  const answer = validateResolved(await read(resolveAddress(base, paths)))
  const asked = new Set(paths)
  const said = new Set(answer.paths.map((entry) => entry.path))
  if (said.size !== asked.size || [...asked].some((path) => !said.has(path)))
    invalid('documents.resolve.paths', 'does not answer the paths asked')
  return answer.paths
}

/**
 * The Markdown files of the project a planning space is bound to that a query names,
 * by their path first and then by a line; each path is what `resolve` takes from that space.
 */
export async function searchSpaceDocuments(
  space: string,
  query: string,
  signal: AbortSignal,
): Promise<FoundDocument[]> {
  const parameters = new URLSearchParams({ space, q: query })
  const answer = await read(`/api/documents/search?${parameters.toString()}`, signal)
  return validateFound(answer).documents
}

/** One Markdown file's words, as `resolve` named it. */
export async function readDocument(project: string, path: string): Promise<ProjectDocument> {
  const parameters = new URLSearchParams({ project, path })
  const document = validateDocument(await read(`/api/documents/read?${parameters.toString()}`))
  if (document.project !== project || document.path !== path)
    invalid('documents.read', 'does not answer the document asked')
  return document
}
