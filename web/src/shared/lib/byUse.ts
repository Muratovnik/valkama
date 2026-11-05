/**
 * Values by how many times they occur, then by name: the common ones first.
 *
 * What the board's filter menu and the new-task dialog both offer from the labels a
 * space already uses, so the two lists read in one order.
 */
export function byUse(values: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.keys()].sort(
    (left, right) =>
      (counts.get(right) ?? 0) - (counts.get(left) ?? 0) || left.localeCompare(right),
  )
}
