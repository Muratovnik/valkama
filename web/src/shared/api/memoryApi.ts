/**
 * The knowledge a project points at, searched through whichever provider answers.
 *
 * Four reads and no write, because the provider behind them has none. An
 * interface that offered one would be pretending a read-only source is a
 * different kind of source, which is the one thing §16.7 says this module must
 * not do — so the capability list travels with every answer and the view offers
 * exactly what it names.
 *
 * Only `searchMemory` needs a provider to be reachable. The provider listing
 * and the attached pointers read the registry and Valkama's own rows, so both
 * still answer when every knowledge root on the machine is gone — which is the
 * state a reader most needs a page for.
 */

import { parseContract, strictObject, z } from '@/shared/api/contract.ts'
import { secureFetch } from '@/shared/api/secureFetch.ts'

/** Why a provider cannot answer: a code to decide on, a sentence to show. */
interface MemoryReason {
  code: string
  message: string
}

export interface MemoryResult {
  connection_id: string
  external_id: string
  label: string
  metadata: Record<string, string>
  observed_at: string
  resource_type: string
  snippet: string
}

export interface MemorySearch {
  capabilities: string[]
  health: string
  interface_version: 'valkama-memory-api'
  project_id: string
  provider_id: string
  reason: MemoryReason | null
  results: MemoryResult[]
  /** The folder that answered. Two projects both searching `docs` is ordinary. */
  root: string
  truncated: boolean
}

/** One project's knowledge provider, and whether it can be asked at all. */
export interface MemoryProvider {
  capabilities: string[]
  health: string
  project_id: string
  provider_id: string
  reason: MemoryReason | null
  root: string
  title: string
}

export interface MemoryProviders {
  interface_version: 'valkama-memory-api'
  providers: MemoryProvider[]
}

/**
 * A pointer attached to a work item.
 *
 * The label was stored when it was attached and is never re-derived: that is
 * what lets the row still read when nothing can resolve the pointer, which is
 * exactly when a reader is looking.
 */
export interface MemoryLink {
  attached_at: string
  author: string
  label: string
  /** The space the item lives in, which is what the shell needs to reach it. */
  space_key: string
  value: string
  work_item_id: string
  work_item_key: string
  work_item_title: string
}

export interface MemoryLinks {
  interface_version: 'valkama-memory-api'
  links: MemoryLink[]
  project_id: string
  truncated: boolean
}

const text = (max = 4096) => z.string().max(max)
const reasonSchema = strictObject({ code: text(120), message: text(1000) }).nullable()
const capabilitySchema = z.array(text(120)).max(50)
const resultSchema = strictObject({
  connection_id: text(240),
  external_id: text(256),
  label: text(200),
  metadata: z.record(text(64), text(500)),
  observed_at: text(120),
  resource_type: text(120),
  snippet: text(500),
})
const searchSchema = strictObject({
  capabilities: capabilitySchema,
  health: text(120),
  interface_version: z.literal('valkama-memory-api'),
  project_id: text(240),
  provider_id: text(240),
  reason: reasonSchema,
  results: z
    .array(resultSchema)
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => `${item.connection_id}\u{0}${item.external_id}`)).size ===
        items.length,
      { message: 'duplicate memory identity' },
    ),
  root: text(),
  truncated: z.boolean(),
})
const providerSchema = strictObject({
  capabilities: capabilitySchema,
  health: text(120),
  project_id: text(240),
  provider_id: text(240),
  reason: reasonSchema,
  root: text(),
  title: text(240),
})
const providersSchema = strictObject({
  interface_version: z.literal('valkama-memory-api'),
  providers: z
    .array(providerSchema)
    .max(10_000)
    .refine((items) => new Set(items.map((item) => item.project_id)).size === items.length, {
      message: 'duplicate project identity',
    }),
})
const linkSchema = strictObject({
  attached_at: text(120),
  author: text(240),
  label: text(240),
  space_key: text(80),
  value: text(512),
  work_item_id: text(240),
  work_item_key: text(80),
  work_item_title: text(512),
})
const linksSchema = strictObject({
  interface_version: z.literal('valkama-memory-api'),
  links: z
    .array(linkSchema)
    .max(100)
    .refine(
      (items) =>
        new Set(items.map((item) => `${item.work_item_id}\0${item.value}`)).size === items.length,
      { message: 'duplicate memory attachment' },
    ),
  project_id: text(240),
  truncated: z.boolean(),
})

class MemoryContractError extends Error {
  readonly code = 'memory_contract_invalid'
}

function invalid(path: string, detail: string): never {
  throw new MemoryContractError(`${path}: ${detail}`)
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, path: string): z.infer<T> {
  return parseContract(schema, value, path, invalid)
}

async function read(input: string): Promise<unknown> {
  const response = await secureFetch(input)
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
  return response.json() as Promise<unknown>
}

/** What this project's knowledge provider has for a query, and what it can do. */
export async function searchMemory(projectId: string, query: string): Promise<MemorySearch> {
  const parameters = new URLSearchParams({ project: projectId, q: query })
  const result = parse(
    searchSchema,
    await read(`/api/memory/search?${parameters.toString()}`),
    'memory.search',
  )
  if (result.project_id !== projectId)
    invalid('memory.search.project_id', 'does not match requested project')
  return result
}

/** Which provider answers for each registered project, including those that cannot. */
export async function fetchMemoryProviders(): Promise<MemoryProviders> {
  return parse(providersSchema, await read('/api/memory/providers'), 'memory.providers')
}

/** The pointers this project's work already carries. No provider is asked. */
export async function fetchMemoryLinks(projectId: string): Promise<MemoryLinks> {
  const parameters = new URLSearchParams({ project: projectId })
  const result = parse(
    linksSchema,
    await read(`/api/memory/linked?${parameters.toString()}`),
    'memory.links',
  )
  if (result.project_id !== projectId)
    invalid('memory.links.project_id', 'does not match requested project')
  return result
}
