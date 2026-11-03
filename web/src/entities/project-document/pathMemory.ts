/**
 * What the server has said of the paths under one base, and the asking for it.
 *
 * The first render asks and the answer is kept for the layer's lifetime, a
 * negative one included, because most paths in old texts are gone and asking
 * again would change nothing. Only a server that did not answer is not kept: a
 * render after a pause asks again, and so does a press.
 */
import { shallowReactive, shallowRef } from 'vue'

import { DocumentRefusal, nextResolveBatch, resolveDocuments } from '@/shared/api/documentApi.ts'
import type { DocumentBase, ResolvedPath } from '@/shared/api/documentApi.ts'
import type { DocumentParts } from '@/shared/lib/textReferences.ts'

/** A server that did not answer is asked again by a later render, no sooner than this. */
const RETRY_AFTER_MS = 10_000

export type Confirmed = Extract<ResolvedPath, { status: 'directory' | 'file' }>

type Reason =
  'ambiguous' | 'missing' | 'network' | 'outside' | 'refused' | 'spaceUnbound' | 'unreachable'

export type Decision =
  | { answer: Confirmed; state: 'confirmed' }
  | { state: 'pending' }
  | { reason: Reason; state: 'unconfirmed' }

/** An absolute or home path does not depend on what a text is rooted in. */
function needsRoot(path: string): boolean {
  return !/^(?:[A-Za-z]:[\\/]|~[\\/])/u.test(path)
}

function reasonOf(answer: ResolvedPath | undefined): Reason {
  if (answer?.status === 'ambiguous') return 'ambiguous'
  if (answer?.status === 'space_unbound') return 'spaceUnbound'
  if (answer?.status === 'refused') return answer.code === 'outside_root' ? 'outside' : 'refused'
  return 'missing'
}

/** What is known about a query. A card that changes base starts from nothing. */
class Told {
  readonly answers = shallowReactive(new Map<string, ResolvedPath>())
  /** Paths the server did not answer for, and when. */
  readonly unreachable = shallowReactive(new Map<string, number>())
  /** The base has no root, so no relative path can resolve and none is asked. */
  readonly unbound = shallowRef(false)

  decide(query: DocumentParts): Decision {
    const [first] = query.paths
    if (first === undefined) return { state: 'unconfirmed', reason: 'network' }
    if (this.unbound.value && needsRoot(first))
      return { state: 'unconfirmed', reason: 'spaceUnbound' }
    for (const path of query.paths) {
      const answer = this.answers.get(path)
      if (answer?.status === 'file' || answer?.status === 'directory')
        return { state: 'confirmed', answer }
      // The variant without a tail wins when both exist, so it is waited for.
      if (!answer)
        return this.unreachable.has(path)
          ? { state: 'unconfirmed', reason: 'unreachable' }
          : { state: 'pending' }
    }
    return { state: 'unconfirmed', reason: reasonOf(this.answers.get(first)) }
  }

  /** A request the server refused will be refused again; one it never answered may not. */
  learn(batch: readonly string[], error: unknown) {
    const final = error instanceof DocumentRefusal && error.status < 500
    for (const path of batch) {
      if (final) this.answers.set(path, { path, status: 'refused', code: 'invalid_path' })
      else this.unreachable.set(path, Date.now())
    }
  }

  hear(answers: readonly ResolvedPath[]) {
    for (const answer of answers) {
      if (answer.status === 'space_unbound') this.unbound.value = true
      this.answers.set(answer.path, answer)
      this.unreachable.delete(answer.path)
    }
  }

  /** Whether a render or a press has any reason to ask about this path. */
  wouldAsk(path: string, now: boolean): boolean {
    if (this.answers.has(path) || (this.unbound.value && needsRoot(path))) return false
    const failedAt = this.unreachable.get(path)
    return failedAt === undefined || now || Date.now() - failedAt >= RETRY_AFTER_MS
  }
}

export function pathMemory(base: DocumentBase) {
  const told = new Told()
  told.unbound.value = !('project' in base) && !base.space
  const queued = new Set<string>()
  const waiting = new Set<() => void>()
  let pumping = false

  /** One request at a time, so an answer that the space has no root spares the rest. */
  async function pump() {
    pumping = true
    while (queued.size) {
      const batch = nextResolveBatch(base, [...queued])
      await resolveDocuments(base, batch).then(
        (answers) => told.hear(answers),
        (error: unknown) => told.learn(batch, error),
      )
      for (const path of batch) queued.delete(path)
      if (told.unbound.value) for (const path of queued) if (needsRoot(path)) queued.delete(path)
      for (const wake of waiting) wake()
    }
    pumping = false
  }

  function ask(path: string, now = false) {
    if (queued.has(path) || !told.wouldAsk(path, now)) return
    queued.add(path)
    // One render's paths go together: the rest of it runs before this microtask.
    if (queued.size === 1 && !pumping) queueMicrotask(() => void pump())
  }

  /** Resolves once the query is no longer pending. */
  function decided(query: DocumentParts): Promise<Decision> {
    return new Promise((resolve) => {
      const settle = () => {
        const decision = told.decide(query)
        if (decision.state === 'pending') return
        waiting.delete(settle)
        resolve(decision)
      }
      waiting.add(settle)
      settle()
    })
  }

  return { ask, decide: (query: DocumentParts) => told.decide(query), decided }
}
