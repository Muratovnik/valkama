/**
 * An attached commit as the card names it, and which of an item's commits a hash written in
 * its text means.
 */
import type { WorkItem } from '@/shared/api/planningModel.ts'

export type AttachedCommit = NonNullable<WorkItem['commits']>[number]

/** As much of a hash as names a commit to a reader: git's own short form. */
const SHORT_HASH = 8

/**
 * The pair that finds a commit, its repository and its hash, as `valkama · a3cc0de4`. A commit
 * of no known repository is its hash alone.
 */
export function commitName(commit: Pick<AttachedCommit, 'hash' | 'repository'>): string {
  const hash = commit.hash.slice(0, SHORT_HASH)
  return commit.repository ? `${commit.repository} · ${hash}` : hash
}

/**
 * The attached commit a hash written in text means: the one whose hash it starts, or that
 * starts it, at the seven characters git abbreviates to, which the text's own rule already
 * asks of a hash. Null where none does, and where several repositories hold commits it could
 * be, since the text names no repository and the link would guess one.
 */
export function writtenCommit(
  commits: readonly AttachedCommit[],
  written: string,
): AttachedCommit | null {
  const hash = written.toLowerCase()
  const found = commits.filter(
    (commit) => commit.hash.startsWith(hash) || hash.startsWith(commit.hash),
  )
  return found.length === 1 ? found[0] : null
}
