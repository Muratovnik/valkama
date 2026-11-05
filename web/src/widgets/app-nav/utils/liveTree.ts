/**
 * The frame's rows as the tree the list draws: each row under the row its `parent`
 * names. The frame is flat and in order, and `parent` always names a row of the same
 * space, so the tree keeps that order at every level and goes as deep as the parents
 * do; nothing here sorts. A row whose parent is not shown — one fading on its own —
 * stands at the space's own level rather than vanishing.
 */
import type { ShownRow } from '@/shared/lib/liveWorkRows.ts'

export interface LiveNode {
  children: LiveNode[]
  row: ShownRow
}

export function liveTree(rows: readonly ShownRow[]): LiveNode[] {
  const nodes = new Map(rows.map((row) => [row.reference, { row, children: [] } as LiveNode]))
  const top: LiveNode[] = []
  for (const row of rows) {
    const node = nodes.get(row.reference)
    if (node === undefined) continue
    const parent = row.parent === null ? undefined : nodes.get(row.parent)
    if (parent && parent !== node) parent.children.push(node)
    else top.push(node)
  }
  return top
}

/** A row's number as the list prints it under its space's name: the key is already said. */
export function rowNumber(reference: string): string {
  return reference.slice(reference.lastIndexOf('-') + 1)
}
